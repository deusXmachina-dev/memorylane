import { v4 as uuidv4 } from 'uuid'
import { OpenRouter, stepCountIs } from '@openrouter/sdk'
import { callModel } from '@openrouter/sdk/funcs/call-model'
import type { StorageService } from '../../storage'
import type { Pattern, PatternSighting } from '../../storage/pattern-repository'
import type { EmbeddingService } from '../../processor/embedding'
import log from '../../logger'
import type {
  PatternDetectorConfig,
  DetectionRunResult,
  ProgressCallback,
  Candidate,
} from './types'
import { DEFAULT_DETECTOR_CONFIG } from './types'
import {
  getDayBoundaries,
  serializeActivities,
  extractJsonArray,
  extractJsonObject,
  generatePatternId,
} from './helpers'
import { buildScanSystemPrompt, buildVerificationSystemPrompt } from './prompts'
import { buildVerificationTools } from './tools'

const VERIFICATION_MAX_STEPS = 8

export async function runDetection(
  apiKey: string,
  storage: StorageService,
  embeddingService: EmbeddingService,
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
  // Phase 2: Verify — sequential per-candidate deep investigation with tool use
  // Sequential so each verifier sees patterns created by previous candidates.
  // =========================================================================

  const tools = buildVerificationTools(storage, embeddingService, start, end, progress)

  progress(`[Phase 2] Verifying ${candidates.length} candidates with tool access...`)

  let newPatterns = 0
  let updatedPatterns = 0
  let candidatesVerified = 0
  let candidatesRejected = 0

  for (const candidate of candidates) {
    // Re-fetch existing patterns each iteration so the verifier sees newly created ones
    const currentPatterns = storage.patterns.getAllPatterns()

    try {
      const verifyPrompt = buildVerificationSystemPrompt(candidate, currentPatterns)

      // Enrich candidate with full activity details
      const candidateActivities = candidate.activity_ids?.length
        ? storage.activities.getByIds(candidate.activity_ids)
        : []
      const enrichedActivities = candidateActivities.map((a) => ({
        id: a.id,
        app: a.appName,
        window_title: a.windowTitle,
        time: new Date(a.startTimestamp).toISOString(),
        end_time: new Date(a.endTimestamp).toISOString(),
        duration_min: Math.round((a.endTimestamp - a.startTimestamp) / 60000),
        summary: a.summary,
      }))

      const candidateWithActivities = {
        ...candidate,
        activities: enrichedActivities,
      }
      // Remove raw activity_ids from the input since we're providing full details
      delete (candidateWithActivities as Record<string, unknown>).activity_ids

      const candidateInput = `Investigate this candidate pattern:\n\n\`\`\`json\n${JSON.stringify(candidateWithActivities, null, 2)}\n\`\`\``

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
        candidatesRejected++
        progress(`[Phase 2] Error verifying "${candidate.name}": Could not parse response`)
        continue
      }

      const verdict = parsed.verdict as string

      if (verdict === 'reject') {
        candidatesRejected++
        progress(
          `[Phase 2] Rejected: ${candidate.name} — ${(parsed.reason as string) || 'rejected by verifier'}`,
        )
        continue
      }

      // -- Persist immediately so next iteration sees this pattern --

      const sightingId = uuidv4()

      if (verdict === 'sighting') {
        const existingId = parsed.existing_pattern_id as string
        const existing = existingId ? storage.patterns.getPatternById(existingId) : null

        if (existing) {
          storage.patterns.addSighting({
            id: sightingId,
            patternId: existingId,
            detectedAt: now,
            runId,
            evidence: (parsed.evidence as string) || '',
            activityIds: (parsed.activity_ids as string[]) || candidate.activity_ids,
            confidence: (parsed.confidence as number) ?? candidate.confidence,
            durationEstimateMin: (parsed.duration_estimate_min as number) ?? null,
          } satisfies PatternSighting)

          const updates = parsed.updates as Record<string, unknown> | undefined
          if (updates) {
            storage.patterns.updatePattern(existingId, {
              name: updates.name as string | undefined,
              description: updates.description as string | undefined,
              apps: updates.apps as string[] | undefined,
              automationIdea: updates.automation_idea as string | undefined,
            })
          }

          updatedPatterns++
          candidatesVerified++
          progress(`[Phase 2] Verified (sighting): ${candidate.name}`)
          continue
        }
      }

      // verdict === 'new' or sighting with invalid ID → create new pattern
      const finding = {
        name: (parsed.name as string) || candidate.name,
        description: (parsed.description as string) || candidate.description,
        apps: (parsed.apps as string[]) || candidate.apps,
        automationIdea: (parsed.automation_idea as string) || '',
        durationEstimateMin: (parsed.duration_estimate_min as number) ?? null,
        confidence: (parsed.confidence as number) ?? candidate.confidence,
        evidence: (parsed.evidence as string) || '',
        activityIds: (parsed.activity_ids as string[]) || candidate.activity_ids,
      }

      const patternId = generatePatternId(finding.name)
      storage.patterns.addPattern({
        id: patternId,
        name: finding.name,
        description: finding.description,
        apps: finding.apps,
        automationIdea: finding.automationIdea,
        createdAt: now,
        rejectedAt: null,
        promptCopiedAt: null,
        approvedAt: null,
      } satisfies Pattern)

      storage.patterns.addSighting({
        id: sightingId,
        patternId,
        detectedAt: now,
        runId,
        evidence: finding.evidence,
        activityIds: finding.activityIds,
        confidence: finding.confidence,
        durationEstimateMin: finding.durationEstimateMin,
      } satisfies PatternSighting)

      newPatterns++
      candidatesVerified++
      progress(`[Phase 2] Verified (new): ${candidate.name}`)
    } catch (error) {
      candidatesRejected++
      progress(
        `[Phase 2] Error verifying "${candidate.name}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  progress(
    `[Phase 2] ${candidatesVerified} verified, ${candidatesRejected} rejected out of ${candidates.length} candidates`,
  )

  const result: DetectionRunResult = {
    runId,
    newPatterns,
    updatedPatterns,
    totalFindings: candidatesVerified,
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
