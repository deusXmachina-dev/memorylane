import { v4 as uuidv4 } from 'uuid'
import { generateText, stepCountIs } from 'ai'
import type { StorageService } from '../../storage'
import type { Sighting } from '../../storage/sighting-repository'
import type { EmbeddingService } from '../../processor/embedding'
import type { InferenceProvider } from '../../llm'
import log from '@main/utils/logger'
import type { TaskMinerConfig, MiningRunResult, ProgressCallback, Candidate } from './types'
import { DEFAULT_MINER_CONFIG } from './types'
import {
  getDayBoundaries,
  serializeActivities,
  tryExtractJsonArray,
  extractJsonObject,
} from '../pattern-detector/helpers'
import { buildVerificationTools } from '../pattern-detector/tools'
import { computeEpisodeWindow } from './helpers'
import { normalizeScanCandidates } from './candidate-normalizer'
import { buildScanSystemPrompt, buildGroundingSystemPrompt } from './prompts'

const GROUNDING_MAX_STEPS = 8
const SIGHTING_MAX_AGE_DAYS = 90
// A malformed scan response — no parseable JSON, or candidates that all fail
// validation / cite unknown ids — silently loses the whole day, so retry it.
// A response that parses to `[]` is a legitimate empty day, not a failure.
const SCAN_MAX_ATTEMPTS = 3

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

  // 0. Prune very old sightings (DB hygiene)
  const prunedSightings = storage.sightings.pruneOlderThan(SIGHTING_MAX_AGE_DAYS, now)
  if (prunedSightings)
    progress(`Pruned ${prunedSightings} sightings older than ${SIGHTING_MAX_AGE_DAYS}d`)

  // 1. Query activities for the target day
  const { start, end, label } = getDayBoundaries(cfg.lookbackDays)
  const activities = storage.activities.getForDay(start, end)
  progress(`Found ${activities.length} activities for ${label}`)

  if (activities.length === 0) {
    progress('No activities for this day, skipping')
    storage.miningRuns.record(now)
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

  // Serve compact positional ids (a1..aN) to the scan instead of raw UUIDs —
  // models mangle long opaque ids when citing them (dropping whole findings),
  // and short handles cut prompt tokens. Mapped back right after parsing.
  const realIdOf = new Map<string, string>()
  const serialized = serializeActivities(activities).map((row, i) => {
    const shortId = `a${i + 1}`
    realIdOf.set(shortId, activities[i].id)
    return { ...row, id: shortId }
  })
  const scanPrompt = buildScanSystemPrompt(label, userContextStr)
  const scanUserMessage = `Here are all ${activities.length} activities from ${label}:\n\n\`\`\`json\n${JSON.stringify(serialized, null, 2)}\n\`\`\``

  // Parses one scan response through validation and short-id mapping, dropping
  // ids the model invented and candidates left with no grounding. Returns null
  // when the response held no JSON array at all.
  const parseScanResponse = (text: string) => {
    const raw = tryExtractJsonArray<unknown>(text)
    if (raw === null) return null
    const {
      candidates: normalizedCandidates,
      malformedCount,
      droppedNoActivityIds,
    } = normalizeScanCandidates(raw)
    let unmappedIds = 0
    const candidates: Candidate[] = normalizedCandidates
      .map((c) => {
        const ids = c.activity_ids
          .map((sid) => realIdOf.get(sid.trim()))
          .filter((id): id is string => Boolean(id))
        unmappedIds += c.activity_ids.length - ids.length
        return { ...c, activity_ids: ids }
      })
      .filter((c) => c.activity_ids.length > 0)
    const droppedUnmappedCandidates = normalizedCandidates.length - candidates.length
    return {
      raw,
      candidates,
      malformedCount,
      droppedNoActivityIds,
      droppedUnmappedCandidates,
      unmappedIds,
    }
  }

  let scan: ReturnType<typeof parseScanResponse> = null
  for (let attempt = 1; attempt <= SCAN_MAX_ATTEMPTS; attempt++) {
    progress(
      `[Phase 1] Sending ${activities.length} activities to ${cfg.model}...` +
        (attempt > 1 ? ` (attempt ${attempt}/${SCAN_MAX_ATTEMPTS})` : ''),
    )
    const scanResult = await generateText({
      model: provider.languageModel(cfg.model),
      system: scanPrompt,
      prompt: scanUserMessage,
    })

    scanInputTokens += scanResult.usage.inputTokens ?? 0
    scanOutputTokens += scanResult.usage.outputTokens ?? 0
    progress(
      `[Phase 1] Response received (${scanResult.usage.inputTokens ?? 0} in / ${scanResult.usage.outputTokens ?? 0} out tokens)`,
    )

    scan = parseScanResponse(scanResult.text)
    if (scan === null) {
      progress(
        `[Phase 1] No JSON array in response${attempt < SCAN_MAX_ATTEMPTS ? ' — retrying' : ''}`,
      )
      continue
    }
    // A parsed `[]` is an empty day; parsed-but-unusable candidates are a
    // failed response worth retrying.
    if (scan.raw.length === 0 || scan.candidates.length > 0) break
    progress(
      `[Phase 1] Parsed ${scan.raw.length} candidates but none usable${attempt < SCAN_MAX_ATTEMPTS ? ' — retrying' : ''}`,
    )
  }

  const rawCandidates = scan?.raw ?? []
  const candidates = scan?.candidates ?? []
  if (scan) {
    progress(
      `[Phase 1] Parsed ${scan.raw.length} candidates (${candidates.length} valid, ${scan.malformedCount} malformed, ` +
        `${scan.droppedNoActivityIds + scan.droppedUnmappedCandidates} dropped for no activity_ids, ${scan.unmappedIds} unknown ids)`,
    )
  }

  if (candidates.length === 0) {
    progress('No grounded candidates, done')
    storage.miningRuns.record(now)
    return emptyResult(runId, rawCandidates.length, {
      scanIn: scanInputTokens,
      scanOut: scanOutputTokens,
      verifyIn: 0,
      verifyOut: 0,
    })
  }

  // =========================================================================
  // Phase 2: Ground — per-candidate confirmation with tool use, then write
  // a grounded sighting (computed window). No pattern matching. In scan-only
  // mode the scan's candidates are written directly (no LLM confirmation).
  // =========================================================================

  const tools = cfg.scanOnly
    ? undefined
    : buildVerificationTools(storage, embeddingService, start, end, progress)
  // The grounding tools (search/browse) can surface activities from other days;
  // a sighting must stay inside the day being mined, so its final ids are
  // intersected with this window before the duration is computed.
  const dayActivityIds = new Set(activities.map((a) => a.id))
  progress(
    cfg.scanOnly
      ? `[Phase 2] Scan-only: writing ${candidates.length} candidates without grounding calls`
      : `[Phase 2] Grounding ${candidates.length} candidates with tool access...`,
  )

  let candidatesKept = 0
  let candidatesRejected = 0

  for (const candidate of candidates) {
    try {
      let parsed: Record<string, unknown> = {}
      if (!cfg.scanOnly) {
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

        const verifyParsed = extractJsonObject<Record<string, unknown>>(verifyResult.text)
        if (!verifyParsed) {
          candidatesRejected++
          progress(`[Phase 2] Rejected "${candidate.title}": could not parse response`)
          continue
        }

        if ((verifyParsed.verdict as string) === 'reject') {
          candidatesRejected++
          progress(
            `[Phase 2] Rejected: ${candidate.title} — ${(verifyParsed.reason as string) || 'rejected'}`,
          )
          continue
        }
        parsed = verifyParsed
      }

      // Finalize activity_ids and resolve them to real activities. The window
      // and interaction time are computed from these — never LLM-estimated.
      const requestedIds = (parsed.activity_ids as string[] | undefined)?.length
        ? (parsed.activity_ids as string[])
        : candidate.activity_ids
      // Keep only ids inside the day being mined — a sighting can't span days,
      // and an out-of-window id would inflate the computed duration.
      const finalIds = requestedIds.filter((id) => dayActivityIds.has(id))
      const droppedOutOfWindow = requestedIds.length - finalIds.length
      if (droppedOutOfWindow > 0) {
        progress(
          `[Phase 2] "${candidate.title}": dropped ${droppedOutOfWindow} activity id(s) outside ${label}`,
        )
      }
      const resolved = storage.activities.getByIds(finalIds)
      if (resolved.length === 0) {
        candidatesRejected++
        progress(`[Phase 2] Rejected "${candidate.title}": no resolvable activities`)
        continue
      }

      const title = (parsed.title as string) || candidate.title
      const description = (parsed.description as string) || candidate.description
      const apps = (parsed.apps as string[]) || candidate.apps
      const { startedAt, endedAt, interactionMin } = computeEpisodeWindow(resolved)

      storage.sightings.add({
        id: uuidv4(),
        title,
        description,
        apps,
        activityIds: resolved.map((a) => a.id),
        startedAt,
        endedAt,
        interactionMin,
        runId,
        detectedAt: now,
      } satisfies Sighting)

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

  storage.miningRuns.record(now)

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
