/**
 * Pattern detection service.
 *
 * Two-phase agentic detection:
 *   Phase 1 (Scan): Sends a full day's activities in a single LLM call to
 *     discover candidate patterns. Includes top rejected patterns as negative
 *     examples but does NOT include existing patterns (that's Phase 2's job).
 *   Phase 2 (Verify): Each candidate gets its own LLM call with tool access
 *     to OCR text, vector search, and app-filtered browsing. The verifier also
 *     receives all existing patterns and decides whether the candidate is a
 *     re-sighting, a new pattern, or should be discarded.
 *
 * Includes built-in scheduling: call scheduleRun() on screen unlock and the
 * service handles interval guards, settle delays, and error isolation.
 */

import { v4 as uuidv4, v5 as uuidv5 } from 'uuid'
import { OpenRouter, stepCountIs, tool } from '@openrouter/sdk'
import { callModel } from '@openrouter/sdk/funcs/call-model'
import { z } from 'zod'
import type { StorageService, ActivityDetail } from '../storage'
import type { Pattern, PatternSighting, PatternWithStats } from '../storage/pattern-repository'
import type { ApiKeyManager } from '../settings/api-key-manager'
import { PATTERN_DETECTION_CONFIG } from '../../shared/constants'
import { EmbeddingService } from '../processor/embedding'
import log from '../logger'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface PatternDetectorConfig {
  model: string
  lookbackDays: number
}

export const DEFAULT_DETECTOR_CONFIG: PatternDetectorConfig = {
  model: PATTERN_DETECTION_CONFIG.MODEL,
  lookbackDays: PATTERN_DETECTION_CONFIG.LOOKBACK_DAYS,
}

const PATTERN_NAMESPACE = uuidv5('memorylane:pattern', uuidv5.DNS)
const VERIFICATION_MAX_STEPS = 8

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Candidate {
  name: string
  description: string
  apps: string[]
  activity_ids: string[]
  confidence: number
}

interface VerifiedFinding {
  verdict: 'new' | 'sighting'
  name: string
  description: string
  apps: string[]
  automation_idea: string
  duration_estimate_min: number | null
  confidence: number
  evidence: string
  existing_pattern_id?: string
  activity_ids: string[]
}

export interface DetectionRunResult {
  runId: string
  newPatterns: number
  updatedPatterns: number
  totalFindings: number
  candidatesFromScan: number
  candidatesVerified: number
  candidatesRejected: number
  tokenUsage: {
    scan: { input: number; output: number }
    verify: { input: number; output: number }
    total: { input: number; output: number }
  }
}

export type ProgressCallback = (message: string) => void

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

function getDayBoundaries(daysBack: number): { start: number; end: number; label: string } {
  const now = new Date()
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack)
  const start = day.getTime()
  const end = start + 24 * 60 * 60 * 1000 - 1
  const label = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
  return { start, end, label }
}

function serializeActivities(activities: ActivityDetail[]): object[] {
  return activities.map((a) => ({
    id: a.id,
    time: new Date(a.startTimestamp).toISOString(),
    duration_min: Math.round((a.endTimestamp - a.startTimestamp) / 60000),
    app: a.appName,
    window_title: a.windowTitle,
    tld: a.tld,
    summary: a.summary,
  }))
}

// ---------------------------------------------------------------------------
// Phase 1: Scan prompt
// ---------------------------------------------------------------------------

function buildScanSystemPrompt(
  dateLabel: string,
  rejectedPatterns: PatternWithStats[],
  userContext?: string,
): string {
  const userContextSection = userContext ? `\n## User context\n\n${userContext}\n` : ''

  let rejectedSection = ''
  if (rejectedPatterns.length > 0) {
    const examples = rejectedPatterns
      .map((p) => `- "${p.name}" (${p.apps.join(', ')}) — ${p.description}`)
      .join('\n')
    rejectedSection = `

## Previously rejected patterns (DO NOT detect these again)

The user has explicitly rejected these patterns as not useful. Do not output candidates that match or closely resemble them:

${examples}`
  }

  return `You are an automation analyst examining a user's computer activity from ${dateLabel}. Your job is to find work that is repetitive, manual, and could be automated away with a script, API call, or tool.
${userContextSection}
Below you will receive a complete list of activities for the day. Identify **candidate** patterns. Each candidate will be verified in a follow-up step with access to more data, so err on the side of inclusion — "might be a pattern" is fine at this stage.

## What you're looking for

GOOD finds (automatable drudge work):
- Periodically checking values/dashboards and copying them into a spreadsheet or table
- Running the same manual steps repeatedly (e.g., benchmark runs, deploy procedures)
- Filling out forms, quotes, invoices with data that could be pulled from another system
- Copy-pasting data between apps (e.g., CRM → spreadsheet, email → ticket system)
- Repetitive lookup workflows (check status in one app, update in another)
- Manual reporting: gathering numbers from multiple sources into a doc/sheet
- Routine maintenance tasks done the same way each time

BAD finds (not useful, skip these):
- "User programs a lot" — obviously, they're a developer
- "User checks email every morning" — that's just life
- "User uses Chrome and VS Code" — that's just app usage, not a workflow
- Generic habits like "browses the web" or "writes code"
- Any pattern that doesn't have a clear automation opportunity
${rejectedSection}

The key question for each finding: "Could a script, cron job, API integration, or macro do this instead of the human?"

## Output

Output your candidates as a JSON array. Include up to 10 of the most representative activity IDs per candidate.

\`\`\`json
[
  {
    "name": "Short name for the automatable task",
    "description": "What the user appears to do manually — rough is fine, will be refined",
    "apps": ["App1", "App2"],
    "activity_ids": ["IDs of activities that demonstrate this pattern"],
    "confidence": 0.0-1.0
  }
]
\`\`\`

Be inclusive but not noisy. 3-8 candidates is typical. If there's nothing worth investigating, return an empty array \`[]\`.`
}

// ---------------------------------------------------------------------------
// Phase 2: Verification prompt
// ---------------------------------------------------------------------------

function buildVerificationSystemPrompt(
  candidate: Candidate,
  existingPatterns: PatternWithStats[],
): string {
  let patternsSection = ''
  if (existingPatterns.length > 0) {
    const patternsJson = existingPatterns.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      apps: p.apps,
      sighting_count: p.sightingCount,
    }))
    patternsSection = `

## Known patterns

These patterns have been detected before. If the candidate matches one of them, report it as a re-sighting with the pattern's \`id\`.

\`\`\`json
${JSON.stringify(patternsJson, null, 2)}
\`\`\``
  }

  return `You are verifying whether a candidate pattern represents real, automatable, repetitive work.

## Candidate
- Name: ${candidate.name}
- Description: ${candidate.description}
- Apps: ${candidate.apps.join(', ')}
- Activity IDs from initial scan: ${candidate.activity_ids.join(', ')}
- Initial confidence: ${candidate.confidence}
${patternsSection}

## Your task

Use your tools to investigate this candidate:

1. **Read the OCR text** for a few of the candidate's most relevant activity IDs (fetch up to 5 at a time) to see what was actually on screen.
2. **Search for similar activities** across all history to check if this pattern recurs on other days.
3. **Browse activities by app** if you need more context about what the user does in a specific app.
4. **Browse the timeline** around the candidate's time window to see surrounding context and estimate how long the task took.

Then decide one of three outcomes.

For verified patterns (new or sighting), also estimate \`duration_estimate_min\`: how many minutes the user spent on this particular instance of the task. Base this on the activity durations and timestamps you observe in the evidence.

### 1. Re-sighting of known pattern
If this candidate matches an existing known pattern, output:
\`\`\`json
{
  "verdict": "sighting",
  "existing_pattern_id": "ID of the matched known pattern",
  "duration_estimate_min": 5,
  "confidence": 0.0-1.0,
  "evidence": "Why you believe this is the same pattern — specific OCR text, times, cross-day occurrences",
  "activity_ids": ["all supporting activity IDs"]
}
\`\`\`

### 2. New pattern
If this is a genuine, automatable pattern not in the known list, output:
\`\`\`json
{
  "verdict": "new",
  "name": "Refined pattern name",
  "description": "What the user does manually, step by step — informed by OCR and search results",
  "apps": ["App1", "App2"],
  "automation_idea": "How this could be automated (specific: which API, what script, what tool)",
  "duration_estimate_min": 5,
  "confidence": 0.0-1.0,
  "evidence": "Specific evidence — times, window titles, OCR text snippets, cross-day occurrences",
  "activity_ids": ["all supporting activity IDs"]
}
\`\`\`

### 3. Reject
If the evidence is too thin, the pattern is generic, or there's no real automation opportunity:
\`\`\`json
{
  "verdict": "reject",
  "reason": "Why this isn't a real pattern"
}
\`\`\``
}

// ---------------------------------------------------------------------------
// Phase 2: Verification tools
// ---------------------------------------------------------------------------

interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>
}

function buildVerificationTools(storage: StorageService, embeddingService: EmbeddingProvider) {
  return [
    tool({
      name: 'get_activity_ocr',
      description:
        'Fetch OCR text (what was on screen) for specific activities by ID. Use to see the actual content the user was looking at.',
      inputSchema: z.object({
        activity_ids: z
          .array(z.string())
          .min(1)
          .max(5)
          .describe(
            'Activity IDs to fetch OCR for (max 5 per call, call multiple times if needed)',
          ),
      }),
      execute: (params) => {
        const activities = storage.activities.getByIds(params.activity_ids)
        return activities.map((a) => ({
          id: a.id,
          app: a.appName,
          window_title: a.windowTitle,
          time: new Date(a.startTimestamp).toISOString(),
          summary: a.summary,
          ocr_text: a.ocrText || '(no OCR text captured)',
        }))
      },
    }),
    tool({
      name: 'search_similar_activities',
      description:
        'Semantic search across ALL history for activities similar to a query. Use to find whether a pattern recurs on other days.',
      inputSchema: z.object({
        query: z.string().describe('Natural language description of what to search for'),
        limit: z.number().int().min(1).max(20).optional().describe('Max results (default 10)'),
      }),
      execute: async (params) => {
        const embedding = await embeddingService.generateEmbedding(params.query)
        const results = storage.activities.searchVectors(embedding, params.limit ?? 10)
        return results.map((a) => ({
          id: a.id,
          app: a.appName,
          window_title: a.windowTitle,
          time: new Date(a.startTimestamp).toISOString(),
          summary: a.summary,
        }))
      },
    }),
    tool({
      name: 'get_activities_by_app',
      description:
        'Find activities for a specific app within an optional time range. Use to see what else the user did in a particular app.',
      inputSchema: z.object({
        app_name: z.string().describe('Application name (case-insensitive)'),
        start_time: z.string().optional().describe('ISO 8601 start time filter (optional)'),
        end_time: z.string().optional().describe('ISO 8601 end time filter (optional)'),
        limit: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
      }),
      execute: (params) => {
        const startTime = params.start_time ? new Date(params.start_time).getTime() : null
        const endTime = params.end_time ? new Date(params.end_time).getTime() : null
        const results = storage.activities
          .getByTimeRange(startTime, endTime, { appName: params.app_name })
          .slice(0, params.limit ?? 20)
        return results.map((a) => ({
          id: a.id,
          app: a.appName,
          window_title: a.windowTitle,
          time: new Date(a.startTimestamp).toISOString(),
          summary: a.summary,
        }))
      },
    }),
    tool({
      name: 'browse_timeline',
      description:
        'Browse what the user did during a time window. Returns a chronological list of activities with timestamps and durations — useful for understanding context around a candidate and estimating how long a task took.',
      inputSchema: z.object({
        start_time: z.string().describe('ISO 8601 start time'),
        end_time: z.string().describe('ISO 8601 end time'),
        limit: z.number().int().min(1).max(50).optional().describe('Max results (default 30)'),
      }),
      execute: (params) => {
        const startTime = new Date(params.start_time).getTime()
        const endTime = new Date(params.end_time).getTime()
        const results = storage.activities
          .getByTimeRange(startTime, endTime)
          .slice(0, params.limit ?? 30)
        return results.map((a) => ({
          id: a.id,
          app: a.appName,
          window_title: a.windowTitle,
          time: new Date(a.startTimestamp).toISOString(),
          duration_min: Math.round((a.endTimestamp - a.startTimestamp) / 60000),
          summary: a.summary,
        }))
      },
    }),
  ] as const
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

function extractJsonArray<T>(content: string): T[] {
  const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  const jsonStr = jsonMatch ? jsonMatch[1] : content

  try {
    const parsed = JSON.parse(jsonStr)
    if (Array.isArray(parsed)) return parsed as T[]
    return []
  } catch {
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/)
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]) as T[]
      } catch {
        return []
      }
    }
    return []
  }
}

function extractJsonObject<T>(content: string): T | null {
  const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  const jsonStr = jsonMatch ? jsonMatch[1] : content

  try {
    const parsed = JSON.parse(jsonStr)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as T
    return null
  } catch {
    const objMatch = jsonStr.match(/\{[\s\S]*\}/)
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]) as T
      } catch {
        return null
      }
    }
    return null
  }
}

// Keep for backwards compatibility with tests
export function extractFindingsFromResponse(content: string): VerifiedFinding[] {
  return extractJsonArray<VerifiedFinding>(content)
}

// ---------------------------------------------------------------------------
// Pattern ID generation
// ---------------------------------------------------------------------------

function generatePatternId(name: string): string {
  return uuidv5(name.toLowerCase().trim(), PATTERN_NAMESPACE)
}

// ---------------------------------------------------------------------------
// PatternDetector
// ---------------------------------------------------------------------------

export class PatternDetector {
  private running = false
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private model: string = DEFAULT_DETECTOR_CONFIG.model
  private enabled = true
  private readonly embeddingService: EmbeddingProvider

  constructor(
    private readonly storage: StorageService,
    private readonly apiKeyManager?: ApiKeyManager,
    embeddingService?: EmbeddingProvider,
  ) {
    this.embeddingService = embeddingService ?? new EmbeddingService()
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    log.info(`[PatternDetector] ${enabled ? 'Enabled' : 'Disabled'}`)
  }

  updateModel(model: string): void {
    this.model = model && model.trim().length > 0 ? model.trim() : DEFAULT_DETECTOR_CONFIG.model
    log.info(`[PatternDetector] Model updated to: ${this.model}`)
  }

  /**
   * Try to schedule a detection run. Call this on screen unlock / wake.
   */
  scheduleRun(): void {
    if (!this.enabled) return
    if (this.running || this.settleTimer) return

    const apiKey = this.apiKeyManager?.getApiKey()
    if (!apiKey) {
      log.info('[PatternDetector] No API key, skipping')
      return
    }

    const lastRun = this.storage.patterns.getLastRunTimestamp()
    if (lastRun && isSameDay(lastRun, Date.now())) {
      log.info('[PatternDetector] Already ran today, skipping')
      return
    }

    const activityCount = this.storage.activities.count()
    if (activityCount < PATTERN_DETECTION_CONFIG.MIN_ACTIVITIES) {
      log.info(
        `[PatternDetector] Only ${activityCount} activities (need ${PATTERN_DETECTION_CONFIG.MIN_ACTIVITIES}), skipping`,
      )
      return
    }

    log.info(
      `[PatternDetector] Scheduling run in ${PATTERN_DETECTION_CONFIG.SETTLE_DELAY_MS / 1000}s`,
    )
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      void this.execute(apiKey)
    }, PATTERN_DETECTION_CONFIG.SETTLE_DELAY_MS)
  }

  /**
   * Run detection immediately. Used by the CLI.
   */
  async run(
    apiKey: string,
    config: Partial<PatternDetectorConfig> = {},
    onProgress?: ProgressCallback,
  ): Promise<DetectionRunResult> {
    return runDetection(apiKey, this.storage, this.embeddingService, config, onProgress)
  }

  private async execute(apiKey: string): Promise<void> {
    this.running = true
    try {
      const result = await runDetection(apiKey, this.storage, this.embeddingService, {
        model: this.model,
      })
      log.info(
        `[PatternDetector] Run complete: ${result.totalFindings} findings ` +
          `(${result.newPatterns} new, ${result.updatedPatterns} updated), ` +
          `tokens: ${result.tokenUsage.total.input}in/${result.tokenUsage.total.output}out`,
      )
    } catch (error) {
      log.error('[PatternDetector] Run failed:', error)
    } finally {
      this.running = false
    }
  }
}

// ---------------------------------------------------------------------------
// Two-phase detection
// ---------------------------------------------------------------------------

async function runDetection(
  apiKey: string,
  storage: StorageService,
  embeddingService: EmbeddingProvider,
  config: Partial<PatternDetectorConfig> = {},
  onProgress?: ProgressCallback,
): Promise<DetectionRunResult> {
  const cfg = { ...DEFAULT_DETECTOR_CONFIG, ...config }
  const runId = uuidv4()
  const now = Date.now()
  let scanInputTokens = 0
  let scanOutputTokens = 0
  let verifyInputTokens = 0
  let verifyOutputTokens = 0

  const progress = (msg: string) => {
    log.info(`[PatternDetector] ${msg}`)
    onProgress?.(msg)
  }

  progress(`Starting run ${runId} (model=${cfg.model}, lookback=${cfg.lookbackDays}d)`)

  // 0. Prune stale sightings/patterns (>30 days old)
  const pruned = storage.patterns.pruneStale(30)
  if (pruned.sightings || pruned.patterns) {
    progress(`Pruned ${pruned.sightings} stale sightings, ${pruned.patterns} orphaned patterns`)
  }

  // 1. Query activities for the target day
  const { start, end, label } = getDayBoundaries(cfg.lookbackDays)
  const activities = storage.activities.getForDay(start, end)
  progress(`Found ${activities.length} activities for ${label}`)

  if (activities.length === 0) {
    progress('No activities for this day, skipping')
    storage.patterns.recordRun(runId, 0)
    return {
      runId,
      newPatterns: 0,
      updatedPatterns: 0,
      totalFindings: 0,
      candidatesFromScan: 0,
      candidatesVerified: 0,
      candidatesRejected: 0,
      tokenUsage: {
        scan: { input: 0, output: 0 },
        verify: { input: 0, output: 0 },
        total: { input: 0, output: 0 },
      },
    }
  }

  // 2. Load rejected patterns (negative examples for scan) and existing patterns (for verification)
  const rejectedPatterns = storage.patterns.getRejectedPatterns(3)
  const existingPatterns = storage.patterns.getAllPatterns()
  progress(
    `Loaded ${rejectedPatterns.length} rejected (negative examples), ${existingPatterns.length} existing patterns`,
  )

  // 3. Load user context
  const userCtx = storage.userContext.get()
  const userContextStr = userCtx
    ? `${userCtx.shortSummary}\n\n${userCtx.detailedSummary}`
    : undefined

  // =========================================================================
  // Phase 1: Scan — broad candidate discovery
  // =========================================================================

  const serialized = serializeActivities(activities)
  const scanPrompt = buildScanSystemPrompt(label, rejectedPatterns, userContextStr)
  const scanUserMessage = `Here are all ${activities.length} activities from ${label}:\n\n\`\`\`json\n${JSON.stringify(serialized, null, 2)}\n\`\`\``

  const client = new OpenRouter({ apiKey })

  progress(`[Phase 1] Sending ${activities.length} activities to ${cfg.model}...`)
  const scanResponse = await client.chat.send({
    model: cfg.model,
    messages: [
      { role: 'system', content: scanPrompt },
      { role: 'user', content: scanUserMessage },
    ],
  })

  const scanChoice = scanResponse.choices?.[0]
  const scanContent =
    typeof scanChoice?.message?.content === 'string' ? scanChoice.message.content : ''

  scanInputTokens = scanResponse.usage?.promptTokens || 0
  scanOutputTokens = scanResponse.usage?.completionTokens || 0
  progress(
    `[Phase 1] Response received (${scanResponse.usage?.promptTokens || 0} in / ${scanResponse.usage?.completionTokens || 0} out tokens)`,
  )

  const candidates = extractJsonArray<Candidate>(scanContent)
  progress(`[Phase 1] Found ${candidates.length} candidates`)

  if (candidates.length === 0) {
    progress('No candidates to verify, done')
    storage.patterns.recordRun(runId, 0)
    return {
      runId,
      newPatterns: 0,
      updatedPatterns: 0,
      totalFindings: 0,
      candidatesFromScan: 0,
      candidatesVerified: 0,
      candidatesRejected: 0,
      tokenUsage: {
        scan: { input: scanInputTokens, output: scanOutputTokens },
        verify: { input: verifyInputTokens, output: verifyOutputTokens },
        total: {
          input: scanInputTokens + verifyInputTokens,
          output: scanOutputTokens + verifyOutputTokens,
        },
      },
    }
  }

  // =========================================================================
  // Phase 2: Verify — per-candidate deep investigation with tool use
  // =========================================================================

  const tools = buildVerificationTools(storage, embeddingService)

  progress(`[Phase 2] Verifying ${candidates.length} candidates with tool access...`)

  type VerificationOutcome =
    | { status: 'verified'; finding: VerifiedFinding; candidateName: string }
    | { status: 'rejected'; candidateName: string; reason: string }
    | { status: 'error'; candidateName: string; error: string }

  const verificationPromises = candidates.map(async (candidate): Promise<VerificationOutcome> => {
    try {
      const verifyPrompt = buildVerificationSystemPrompt(candidate, existingPatterns)
      const candidateInput = `Investigate this candidate pattern:\n\n\`\`\`json\n${JSON.stringify(candidate, null, 2)}\n\`\`\``

      const result = callModel(client, {
        model: cfg.model,
        instructions: verifyPrompt,
        input: candidateInput,
        tools,
        stopWhen: stepCountIs(VERIFICATION_MAX_STEPS),
      })

      const text = await result.getText()
      const response = await result.getResponse()

      const usage = response?.usage
      if (usage) {
        verifyInputTokens += usage.inputTokens || 0
        verifyOutputTokens += usage.outputTokens || 0
      }

      const parsed = extractJsonObject<Record<string, unknown>>(text)
      if (!parsed) {
        return {
          status: 'error',
          candidateName: candidate.name,
          error: 'Could not parse verification response',
        }
      }

      const verdict = parsed.verdict as string

      if (verdict === 'reject') {
        return {
          status: 'rejected',
          candidateName: candidate.name,
          reason: (parsed.reason as string) || 'rejected by verifier',
        }
      }

      if (verdict === 'sighting') {
        return {
          status: 'verified',
          candidateName: candidate.name,
          finding: {
            verdict: 'sighting',
            name: candidate.name,
            description: candidate.description,
            apps: candidate.apps,
            automation_idea: '',
            duration_estimate_min: (parsed.duration_estimate_min as number) ?? null,
            confidence: (parsed.confidence as number) ?? candidate.confidence,
            evidence: (parsed.evidence as string) || '',
            existing_pattern_id: parsed.existing_pattern_id as string,
            activity_ids: (parsed.activity_ids as string[]) || candidate.activity_ids,
          },
        }
      }

      // verdict === 'new' or unrecognized (treat as new)
      return {
        status: 'verified',
        candidateName: candidate.name,
        finding: {
          verdict: 'new',
          name: (parsed.name as string) || candidate.name,
          description: (parsed.description as string) || candidate.description,
          apps: (parsed.apps as string[]) || candidate.apps,
          automation_idea: (parsed.automation_idea as string) || '',
          duration_estimate_min: (parsed.duration_estimate_min as number) ?? null,
          confidence: (parsed.confidence as number) ?? candidate.confidence,
          evidence: (parsed.evidence as string) || '',
          activity_ids: (parsed.activity_ids as string[]) || candidate.activity_ids,
        },
      }
    } catch (error) {
      return {
        status: 'error',
        candidateName: candidate.name,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  const verificationResults = await Promise.allSettled(verificationPromises)

  // =========================================================================
  // Persist verified findings
  // =========================================================================

  const findings: VerifiedFinding[] = []
  let candidatesVerified = 0
  let candidatesRejected = 0

  for (const settled of verificationResults) {
    if (settled.status === 'rejected') {
      progress(`[Phase 2] Verification promise failed: ${settled.reason}`)
      candidatesRejected++
      continue
    }

    const vResult = settled.value
    if (vResult.status === 'verified') {
      candidatesVerified++
      findings.push(vResult.finding)
      progress(`[Phase 2] Verified (${vResult.finding.verdict}): ${vResult.candidateName}`)
    } else if (vResult.status === 'rejected') {
      candidatesRejected++
      progress(`[Phase 2] Rejected: ${vResult.candidateName} — ${vResult.reason}`)
    } else {
      candidatesRejected++
      progress(`[Phase 2] Error verifying "${vResult.candidateName}": ${vResult.error}`)
    }
  }

  progress(
    `[Phase 2] ${candidatesVerified} verified, ${candidatesRejected} rejected out of ${candidates.length} candidates`,
  )

  let newPatterns = 0
  let updatedPatterns = 0

  for (const finding of findings) {
    const sightingId = uuidv4()

    if (finding.verdict === 'sighting' && finding.existing_pattern_id) {
      const existing = storage.patterns.getPatternById(finding.existing_pattern_id)
      if (existing) {
        storage.patterns.addSighting({
          id: sightingId,
          patternId: finding.existing_pattern_id,
          detectedAt: now,
          runId,
          evidence: finding.evidence || '',
          activityIds: finding.activity_ids || [],
          confidence: finding.confidence || 0,
          durationEstimateMin: finding.duration_estimate_min,
        } satisfies PatternSighting)
        updatedPatterns++
        progress(`Re-sighting of existing pattern: ${existing.name}`)
        continue
      }
    }

    // New pattern
    const patternId = generatePatternId(finding.name)
    const pattern: Pattern = {
      id: patternId,
      name: finding.name,
      description: finding.description || '',
      apps: finding.apps || [],
      automationIdea: finding.automation_idea || '',
      createdAt: now,
      rejectedAt: null,
      promptCopiedAt: null,
      approvedAt: null,
    }

    storage.patterns.addPattern(pattern)

    storage.patterns.addSighting({
      id: sightingId,
      patternId,
      detectedAt: now,
      runId,
      evidence: finding.evidence || '',
      activityIds: finding.activity_ids || [],
      confidence: finding.confidence || 0,
      durationEstimateMin: finding.duration_estimate_min,
    } satisfies PatternSighting)

    newPatterns++
    progress(`New pattern: ${finding.name}`)
  }

  const result: DetectionRunResult = {
    runId,
    newPatterns,
    updatedPatterns,
    totalFindings: findings.length,
    candidatesFromScan: candidates.length,
    candidatesVerified,
    candidatesRejected,
    tokenUsage: {
      scan: { input: scanInputTokens, output: scanOutputTokens },
      verify: { input: verifyInputTokens, output: verifyOutputTokens },
      total: {
        input: scanInputTokens + verifyInputTokens,
        output: scanOutputTokens + verifyOutputTokens,
      },
    },
  }

  storage.patterns.recordRun(runId, result.totalFindings)

  progress(
    `Run complete: ${candidates.length} candidates → ${result.totalFindings} verified findings ` +
      `(${result.newPatterns} new, ${result.updatedPatterns} updated)`,
  )

  return result
}
