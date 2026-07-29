import { v4 as uuidv4 } from 'uuid'
import { generateText, stepCountIs } from 'ai'
import { PATTERN_DETECTION_CONFIG, SIGHTING_RETENTION_DAYS } from '../../../shared/constants'
import type { StorageService } from '../../storage'
import type { Sighting } from '../../storage/sighting-repository'
import type { ActivityEmbeddingService } from '@main/activity/activity-transformer-types'
import type { InferenceProvider } from '../../llm'
import log from '@main/utils/logger'
import type {
  TaskMinerConfig,
  MiningRunResult,
  ProgressCallback,
  Candidate,
  DayMiningStats,
} from './types'
import { DEFAULT_MINER_CONFIG } from './types'
import {
  computeEpisodeWindow,
  serializeActivities,
  tryExtractJsonArray,
  extractJsonObject,
} from './helpers'
import { getDayBoundaries } from '@main/utils/day'
import { deriveSightingApps } from '@/shared/app-utils'
import { buildVerificationTools } from './tools'
import { normalizeScanCandidates, normalizeSteps } from './candidate-normalizer'
import { buildScanSystemPrompt, buildGroundingSystemPrompt } from './prompts'
import { getKnownProcedureTitles } from './known-procedures'

const GROUNDING_MAX_STEPS = 8
const MIN_RUN_ACTIVITIES = 2
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
  embeddingService: ActivityEmbeddingService,
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

  // Days are mined concurrently, so every line has to name its day to be
  // readable at all.
  const { start, end, label } = getDayBoundaries(cfg.lookbackDays)
  const progress = (msg: string) => {
    const line = `${label}: ${msg}`
    log.info(`[TaskMiner] ${line}`)
    onProgress?.(line)
  }

  progress(`Starting run ${runId} (model=${cfg.model})`)

  // The day's sightings and its ledger status commit in one transaction: a
  // crash mid-run persists nothing, so a retry can never duplicate sightings.
  const commitDay = (sightings: Sighting[], stats: DayMiningStats): void => {
    storage.getDatabase().transaction(() => {
      for (const s of sightings) storage.sightings.add(s)
      cfg.onCommit?.(stats)
    })()
  }

  // 0. Prune very old sightings (DB hygiene)
  const prunedSightings = storage.sightings.pruneOlderThan(SIGHTING_RETENTION_DAYS, now)
  if (prunedSightings)
    progress(`Pruned ${prunedSightings} sightings older than ${SIGHTING_RETENTION_DAYS}d`)

  // 1. Query activities for the target day
  const activities = storage.activities.getForDay(start, end)
  progress(`Found ${activities.length} activities`)

  if (activities.length === 0) {
    progress('No activities for this day, skipping')
    commitDay([], {
      candidatesFromScan: 0,
      candidatesKept: 0,
      candidatesRejected: 0,
      tokensIn: 0,
      tokensOut: 0,
      skippedReason: 'no-activities',
    })
    return emptyResult(runId, 0, { scanIn: 0, scanOut: 0, verifyIn: 0, verifyOut: 0 })
  }

  // 2. User context (optional flavor for the scan)
  const userCtx = storage.userContext.get()
  const userContextStr = userCtx
    ? `${userCtx.shortSummary}\n\n${userCtx.detailedSummary}`
    : undefined

  // Canonical titles of established procedures, fed back so recurring work
  // reuses its name cross-day. Empty on fresh/eval DBs — section omitted.
  const knownProcedures = getKnownProcedureTitles(storage)

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
  const scanPrompt = buildScanSystemPrompt(label, userContextStr, knownProcedures)
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
      model: provider.languageModel(cfg.model, PATTERN_DETECTION_CONFIG.REQUEST_TIMEOUT_MS),
      system: scanPrompt,
      prompt: scanUserMessage,
      maxRetries: 0,
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
    // A parsed `[]` is a legitimately empty day; anything else here means all
    // scan attempts produced unusable output — fail the day so it's retried
    // instead of being silently recorded as mined.
    if (!scan || scan.raw.length > 0) {
      throw new Error(`Scan produced no usable output after ${SCAN_MAX_ATTEMPTS} attempts`)
    }
    progress('No grounded candidates, done')
    commitDay([], {
      candidatesFromScan: rawCandidates.length,
      candidatesKept: 0,
      candidatesRejected: 0,
      tokensIn: scanInputTokens,
      tokensOut: scanOutputTokens,
    })
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
  const pendingSightings: Sighting[] = []

  for (const candidate of candidates) {
    try {
      let parsed: Record<string, unknown> = {}
      if (!cfg.scanOnly) {
        const candidateActivities = storage.activities.getByIds(candidate.activity_ids)
        const groundPrompt = buildGroundingSystemPrompt(
          candidate,
          deriveSightingApps(candidateActivities),
        )

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
            subject: candidate.subject,
            description: candidate.description,
            steps: candidate.steps,
            activities: enrichedActivities,
          },
          null,
          2,
        )}\n\`\`\``

        const verifyResult = await generateText({
          model: provider.languageModel(cfg.model, PATTERN_DETECTION_CONFIG.REQUEST_TIMEOUT_MS),
          system: groundPrompt,
          prompt: candidateInput,
          tools,
          stopWhen: stepCountIs(GROUNDING_MAX_STEPS),
          maxRetries: 0,
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
          `[Phase 2] "${candidate.title}": dropped ${droppedOutOfWindow} activity id(s) outside the day`,
        )
      }
      const resolved = storage.activities.getByIds(finalIds)
      if (resolved.length === 0) {
        candidatesRejected++
        progress(`[Phase 2] Rejected "${candidate.title}": no resolvable activities`)
        continue
      }

      const title = (parsed.title as string) || candidate.title
      const subject = ((parsed.subject as string) || candidate.subject || '').trim()
      const description = (parsed.description as string) || candidate.description
      const groundedSteps = normalizeSteps(parsed.steps)
      const steps = groundedSteps.length > 0 ? groundedSteps : candidate.steps
      const apps = deriveSightingApps(resolved)

      // One candidate = one run on one object = one sighting. The scan separates
      // instances by the object worked on, not by the clock, so a run is never
      // re-split here: a long continuous run stays whole (even across breaks) and
      // back-to-back runs on distinct objects stay distinct. A run with fewer than
      // MIN_RUN_ACTIVITIES substantive activities is noise, not a task run.
      if (resolved.length < MIN_RUN_ACTIVITIES) {
        candidatesRejected++
        progress(`[Phase 2] Rejected "${title}": fewer than ${MIN_RUN_ACTIVITIES} activities`)
        continue
      }
      const { startedAt, endedAt, activeMin } = computeEpisodeWindow(resolved)
      pendingSightings.push({
        id: uuidv4(),
        title,
        subject,
        description,
        steps,
        apps,
        activityIds: resolved.map((a) => a.id),
        startedAt,
        endedAt,
        activeMin,
        runId,
        detectedAt: now,
      } satisfies Sighting)

      candidatesKept++
      progress(`[Phase 2] Kept: ${title} (${resolved.length} activities)`)
    } catch (error) {
      candidatesRejected++
      progress(
        `[Phase 2] Error grounding "${candidate.title}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  commitDay(pendingSightings, {
    candidatesFromScan: rawCandidates.length,
    candidatesKept,
    candidatesRejected,
    tokensIn: scanInputTokens + verifyInputTokens,
    tokensOut: scanOutputTokens + verifyOutputTokens,
  })

  progress(
    `Run complete: ${candidates.length} candidates → ${candidatesKept} sightings (${candidatesRejected} rejected)`,
  )

  return {
    runId,
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
