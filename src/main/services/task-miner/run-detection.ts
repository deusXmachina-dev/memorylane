import { v4 as uuidv4 } from 'uuid'
import { generateText, stepCountIs } from 'ai'
import type { StorageService } from '../../storage'
import type { Sighting } from '../../storage/sighting-repository'
import type { EmbeddingService } from '../../processor/embedding'
import type { InferenceProvider } from '../../llm'
import log from '../../logger'
import type { TaskMinerConfig, MiningRunResult, ProgressCallback } from './types'
import { DEFAULT_MINER_CONFIG } from './types'
import {
  getDayBoundaries,
  serializeActivities,
  extractJsonArray,
  extractJsonObject,
} from '../pattern-detector/helpers'
import { buildVerificationTools } from '../pattern-detector/tools'
import { computeEpisodeWindow } from './helpers'
import { normalizeScanCandidates } from './candidate-normalizer'
import { buildScanSystemPrompt, buildGroundingSystemPrompt } from './prompts'

const GROUNDING_MAX_STEPS = 8
const SIGHTING_MAX_AGE_DAYS = 90

function emptyResult(
  runId: string,
  candidatesFromScan: number,
  tokens: { scanIn: number; scanOut: number; verifyIn: number; verifyOut: number },
): MiningRunResult {
  return {
    runId,
    sightingsFound: 0,
    candidatesFromScan,
    candidatesKept: 0,
    candidatesRejected: 0,
    tokenUsage: {
      scan: { input: tokens.scanIn, output: tokens.scanOut },
      verify: { input: tokens.verifyIn, output: tokens.verifyOut },
      total: { input: tokens.scanIn + tokens.verifyIn, output: tokens.scanOut + tokens.verifyOut },
    },
  }
}

export async function runDetection(
  provider: InferenceProvider,
  storage: StorageService,
  embeddingService: EmbeddingService,
  config: Partial<TaskMinerConfig> = {},
  onProgress?: ProgressCallback,
): Promise<MiningRunResult> {
  const cfg = { ...DEFAULT_MINER_CONFIG, ...config }
  const runId = uuidv4()
  const now = Date.now()
  let scanInputTokens = 0
  let scanOutputTokens = 0
  let verifyInputTokens = 0
  let verifyOutputTokens = 0

  const progress = (msg: string) => {
    log.info(`[TaskMiner] ${msg}`)
    onProgress?.(msg)
  }

  progress(`Starting run ${runId} (model=${cfg.model}, lookback=${cfg.lookbackDays}d)`)

  // 0. Prune very old sightings (DB hygiene; clusters rebuild from what remains)
  const prunedSightings = storage.sightings.pruneOlderThan(SIGHTING_MAX_AGE_DAYS, now)
  if (prunedSightings)
    progress(`Pruned ${prunedSightings} sightings older than ${SIGHTING_MAX_AGE_DAYS}d`)

  // 1. Query activities for the target day
  const { start, end, label } = getDayBoundaries(cfg.lookbackDays)
  const activities = storage.activities.getForDay(start, end)
  progress(`Found ${activities.length} activities for ${label}`)

  if (activities.length === 0) {
    progress('No activities for this day, skipping')
    storage.miningRuns.record(runId, 0, now)
    return emptyResult(runId, 0, { scanIn: 0, scanOut: 0, verifyIn: 0, verifyOut: 0 })
  }

  // 2. User context (optional flavor for the scan)
  const userCtx = storage.userContext.get()
  const userContextStr = userCtx
    ? `${userCtx.shortSummary}\n\n${userCtx.detailedSummary}`
    : undefined

  // =========================================================================
  // Phase 1: Scan — discover discrete task instances
  // =========================================================================

  const serialized = serializeActivities(activities)
  const scanPrompt = buildScanSystemPrompt(label, userContextStr)
  const scanUserMessage = `Here are all ${activities.length} activities from ${label}:\n\n\`\`\`json\n${JSON.stringify(serialized, null, 2)}\n\`\`\``

  progress(`[Phase 1] Sending ${activities.length} activities to ${cfg.model}...`)
  const scanResult = await generateText({
    model: provider.languageModel(cfg.model),
    system: scanPrompt,
    prompt: scanUserMessage,
  })

  scanInputTokens = scanResult.usage.inputTokens ?? 0
  scanOutputTokens = scanResult.usage.outputTokens ?? 0
  progress(`[Phase 1] Response received (${scanInputTokens} in / ${scanOutputTokens} out tokens)`)

  const rawCandidates = extractJsonArray<unknown>(scanResult.text)
  const { candidates, malformedCount, droppedNoActivityIds } =
    normalizeScanCandidates(rawCandidates)
  progress(
    `[Phase 1] Parsed ${rawCandidates.length} candidates (${candidates.length} valid, ${malformedCount} malformed, ${droppedNoActivityIds} dropped for no activity_ids)`,
  )

  if (candidates.length === 0) {
    progress('No grounded candidates, done')
    storage.miningRuns.record(runId, 0, now)
    return emptyResult(runId, rawCandidates.length, {
      scanIn: scanInputTokens,
      scanOut: scanOutputTokens,
      verifyIn: 0,
      verifyOut: 0,
    })
  }

  // =========================================================================
  // Phase 2: Ground — per-candidate confirmation with tool use, then write
  // a grounded sighting (computed window + embedding). No pattern matching.
  // =========================================================================

  const tools = buildVerificationTools(storage, embeddingService, start, end, progress)
  progress(`[Phase 2] Grounding ${candidates.length} candidates with tool access...`)

  let candidatesKept = 0
  let candidatesRejected = 0

  for (const candidate of candidates) {
    try {
      const groundPrompt = buildGroundingSystemPrompt(candidate)

      const candidateActivities = storage.activities.getByIds(candidate.activity_ids)
      const enrichedActivities = candidateActivities.map((a) => ({
        id: a.id,
        app: a.appName,
        window_title: a.windowTitle,
        time: new Date(a.startTimestamp).toISOString(),
        end_time: new Date(a.endTimestamp).toISOString(),
        summary: a.summary,
      }))

      const candidateInput = `Investigate this candidate task:\n\n\`\`\`json\n${JSON.stringify(
        {
          title: candidate.title,
          description: candidate.description,
          apps: candidate.apps,
          activities: enrichedActivities,
        },
        null,
        2,
      )}\n\`\`\``

      const verifyResult = await generateText({
        model: provider.languageModel(cfg.model),
        system: groundPrompt,
        prompt: candidateInput,
        tools,
        stopWhen: stepCountIs(GROUNDING_MAX_STEPS),
      })

      verifyInputTokens += verifyResult.usage.inputTokens ?? 0
      verifyOutputTokens += verifyResult.usage.outputTokens ?? 0

      const parsed = extractJsonObject<Record<string, unknown>>(verifyResult.text)
      if (!parsed) {
        candidatesRejected++
        progress(`[Phase 2] Rejected "${candidate.title}": could not parse response`)
        continue
      }

      if ((parsed.verdict as string) === 'reject') {
        candidatesRejected++
        progress(
          `[Phase 2] Rejected: ${candidate.title} — ${(parsed.reason as string) || 'rejected'}`,
        )
        continue
      }

      // Finalize activity_ids and resolve them to real activities. The window
      // and interaction time are computed from these — never LLM-estimated.
      const finalIds = (parsed.activity_ids as string[] | undefined)?.length
        ? (parsed.activity_ids as string[])
        : candidate.activity_ids
      const resolved = storage.activities.getByIds(finalIds)
      if (resolved.length === 0) {
        candidatesRejected++
        progress(`[Phase 2] Rejected "${candidate.title}": no resolvable activities`)
        continue
      }

      const title = (parsed.title as string) || candidate.title
      const description = (parsed.description as string) || candidate.description
      const apps = (parsed.apps as string[]) || candidate.apps
      const confidence = (parsed.confidence as number) ?? candidate.confidence
      const { startedAt, endedAt, interactionMin } = computeEpisodeWindow(resolved)
      const vector = await embeddingService.generateEmbedding(`${title}\n${description}`)

      storage.sightings.add(
        {
          id: uuidv4(),
          title,
          description,
          apps,
          activityIds: resolved.map((a) => a.id),
          startedAt,
          endedAt,
          interactionMin,
          confidence,
          runId,
          detectedAt: now,
        } satisfies Sighting,
        vector,
      )

      candidatesKept++
      progress(
        `[Phase 2] Kept: ${title} (${interactionMin} min across ${resolved.length} activities)`,
      )
    } catch (error) {
      candidatesRejected++
      progress(
        `[Phase 2] Error grounding "${candidate.title}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  storage.miningRuns.record(runId, candidatesKept, now)

  progress(
    `Run complete: ${candidates.length} candidates → ${candidatesKept} sightings (${candidatesRejected} rejected)`,
  )

  return {
    runId,
    sightingsFound: candidatesKept,
    candidatesFromScan: rawCandidates.length,
    candidatesKept,
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
}
