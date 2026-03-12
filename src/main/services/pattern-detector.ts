/**
 * Pattern detection service.
 *
 * Sends a full day's activities in a single LLM call (via OpenRouter) to
 * discover recurring automatable patterns. Includes built-in scheduling:
 * call scheduleRun() on screen unlock and the service handles interval
 * guards, settle delays, and error isolation.
 */

import { v4 as uuidv4, v5 as uuidv5 } from 'uuid'
import { OpenRouter } from '@openrouter/sdk'
import type { StorageService, ActivityDetail } from '../storage'
import type { Pattern, PatternSighting, PatternWithStats } from '../storage/pattern-repository'
import type { ApiKeyManager } from '../settings/api-key-manager'
import { PATTERN_DETECTION_CONFIG } from '../../shared/constants'
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

// Deterministic namespace for pattern IDs

const PATTERN_NAMESPACE = uuidv5('memorylane:pattern', uuidv5.DNS)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Finding {
  name: string
  description: string
  apps: string[]
  automation_idea: string
  confidence: number
  evidence: string
  existing_pattern_id?: string
  activity_ids?: string[]
}

export interface DetectionRunResult {
  runId: string
  newPatterns: number
  updatedPatterns: number
  totalFindings: number
  tokenUsage: { input: number; output: number }
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

/** Midnight-to-midnight boundaries for a given day offset (0 = today, 1 = yesterday). */
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

function serializeExistingPatterns(patterns: PatternWithStats[]): object[] {
  return patterns.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    apps: p.apps,
    sighting_count: p.sightingCount,
  }))
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  dateLabel: string,
  existingPatterns: PatternWithStats[],
  userContext?: string,
): string {
  const userContextSection = userContext ? `\n## User context\n\n${userContext}\n` : ''

  let patternsSection = ''
  if (existingPatterns.length > 0) {
    patternsSection = `

## Existing patterns (already detected)

Below are patterns found in previous runs. If you see the same pattern again today, include its \`id\` as \`existing_pattern_id\` in your output instead of creating a duplicate.

\`\`\`json
${JSON.stringify(serializeExistingPatterns(existingPatterns), null, 2)}
\`\`\``
  }

  return `You are an automation analyst examining a user's computer activity from ${dateLabel}. Your job is to find work that is repetitive, manual, and could be automated away with a script, API call, or tool.
${userContextSection}
Below you will receive a complete list of activities for the day. Analyze them to find automatable patterns.

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

The key question for each finding: "Could a script, cron job, API integration, or macro do this instead of the human?"
${patternsSection}

## Output

Output your findings as a JSON array:

\`\`\`json
[
  {
    "name": "Short name for the automatable task",
    "description": "What the user does manually, step by step",
    "apps": ["App1", "App2"],
    "automation_idea": "How this could be automated (specific: which API, what script, what tool)",
    "confidence": 0.0-1.0,
    "evidence": "What data you saw that supports this — be specific about times, window titles, summaries",
    "existing_pattern_id": "optional — ID of an existing pattern if this is a re-sighting",
    "activity_ids": ["IDs of activities that demonstrate this pattern"]
  }
]
\`\`\`

Be very selective. Only report things where you genuinely see repeated manual work that a computer could do. 2-3 high-quality finds beats 10 vague ones. If there's nothing automatable, return an empty array \`[]\`.`
}

// ---------------------------------------------------------------------------
// Finding extraction
// ---------------------------------------------------------------------------

export function extractFindingsFromResponse(content: string): Finding[] {
  const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  const jsonStr = jsonMatch ? jsonMatch[1] : content

  try {
    const parsed = JSON.parse(jsonStr)
    if (Array.isArray(parsed)) return parsed as Finding[]
    return []
  } catch {
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/)
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]) as Finding[]
      } catch {
        return []
      }
    }
    return []
  }
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

  constructor(
    private readonly storage: StorageService,
    private readonly apiKeyManager?: ApiKeyManager,
  ) {}

  /**
   * Try to schedule a detection run. Call this on screen unlock / wake.
   * Runs once per day (on the first resume of each calendar day), analyzing
   * the previous day's activities. Guarded by:
   *  - already ran today (based on last sighting timestamp)
   *  - API key availability
   *  - minimum activity count in DB
   * Failures are logged but never propagated.
   */
  scheduleRun(): void {
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
    return runDetection(apiKey, this.storage, config, onProgress)
  }

  private async execute(apiKey: string): Promise<void> {
    this.running = true
    try {
      const result = await runDetection(apiKey, this.storage)
      log.info(
        `[PatternDetector] Run complete: ${result.totalFindings} findings ` +
          `(${result.newPatterns} new, ${result.updatedPatterns} updated), ` +
          `tokens: ${result.tokenUsage.input}in/${result.tokenUsage.output}out`,
      )
    } catch (error) {
      log.error('[PatternDetector] Run failed:', error)
    } finally {
      this.running = false
    }
  }
}

// ---------------------------------------------------------------------------
// Single-shot detection
// ---------------------------------------------------------------------------

async function runDetection(
  apiKey: string,
  storage: StorageService,
  config: Partial<PatternDetectorConfig> = {},
  onProgress?: ProgressCallback,
): Promise<DetectionRunResult> {
  const cfg = { ...DEFAULT_DETECTOR_CONFIG, ...config }
  const runId = uuidv4()
  const now = Date.now()

  const progress = (msg: string) => {
    log.info(`[PatternDetector] ${msg}`)
    onProgress?.(msg)
  }

  progress(`Starting run ${runId} (model=${cfg.model}, lookback=${cfg.lookbackDays}d)`)

  // 1. Query activities for the target day(s)
  const { start, end, label } = getDayBoundaries(cfg.lookbackDays)
  const activities = storage.activities.getForDay(start, end)
  progress(`Found ${activities.length} activities for ${label}`)

  if (activities.length === 0) {
    progress('No activities for this day, skipping')
    return {
      runId,
      newPatterns: 0,
      updatedPatterns: 0,
      totalFindings: 0,
      tokenUsage: { input: 0, output: 0 },
    }
  }

  // 2. Serialize activities
  const serialized = serializeActivities(activities)

  // 3. Load existing patterns for dedup context
  const existingPatterns = storage.patterns.getAllPatterns()
  progress(`Loaded ${existingPatterns.length} existing patterns for dedup`)

  // 3b. Load user context if available
  const userCtx = storage.userContext.get()
  const userContextStr = userCtx
    ? `${userCtx.shortSummary}\n\n${userCtx.detailedSummary}`
    : undefined

  // 4. Build prompt and make single LLM call
  const systemPrompt = buildSystemPrompt(label, existingPatterns, userContextStr)
  const userMessage = `Here are all ${activities.length} activities from ${label}:\n\n\`\`\`json\n${JSON.stringify(serialized, null, 2)}\n\`\`\``

  const client = new OpenRouter({ apiKey })

  progress(`Sending ${activities.length} activities to ${cfg.model}...`)
  const response = await client.chat.send({
    model: cfg.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  })

  const choice = response.choices?.[0]
  const content = typeof choice?.message?.content === 'string' ? choice.message.content : ''

  const totalInputTokens = response.usage?.promptTokens || 0
  const totalOutputTokens = response.usage?.completionTokens || 0
  progress(`Response received (${totalInputTokens} in / ${totalOutputTokens} out tokens)`)

  // 5. Parse findings and persist
  const findings = extractFindingsFromResponse(content)
  let newPatterns = 0
  let updatedPatterns = 0

  for (const finding of findings) {
    const sightingId = uuidv4()

    if (finding.existing_pattern_id) {
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
        } satisfies PatternSighting)
        updatedPatterns++
        progress(`Re-sighting of existing pattern: ${existing.name}`)
        continue
      }
    }

    const patternId = generatePatternId(finding.name)
    const pattern: Pattern = {
      id: patternId,
      name: finding.name,
      description: finding.description || '',
      apps: finding.apps || [],
      automationIdea: finding.automation_idea || '',
      createdAt: now,
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
    } satisfies PatternSighting)

    newPatterns++
    progress(`New pattern: ${finding.name}`)
  }

  const result: DetectionRunResult = {
    runId,
    newPatterns,
    updatedPatterns,
    totalFindings: findings.length,
    tokenUsage: { input: totalInputTokens, output: totalOutputTokens },
  }

  progress(
    `Run complete: ${result.totalFindings} findings (${result.newPatterns} new, ${result.updatedPatterns} updated)`,
  )

  return result
}
