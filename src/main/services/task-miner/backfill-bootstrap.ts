import log from '@main/utils/logger'
import type { InferenceProvider } from '@main/llm'
import type { StorageService } from '../../storage'
import { PATTERN_DETECTION_CONFIG, TASK_BACKFILL } from '../../../shared/constants'
import type { TaskMiner } from '.'

export interface TaskBackfillBootstrapDeps {
  taskMiner: TaskMiner
  provider: InferenceProvider
  storage: StorageService
  /** Settle delay before the backfill starts; defaults to the miner settle delay. */
  delayMs?: number
}

/**
 * Run the one-time task-mining backfill in the background, gated on a single
 * binary signal: has this DB ever been mined?
 *
 * A fresh (or wiped) DB has no recorded mining run, so it gets the one-time
 * seed — mining the recent history that would otherwise take ~30 days of daily
 * runs to accumulate. Any DB that has already been mined keeps its sightings
 * and is skipped. `mining_runs` is the marker: every run records there, even a
 * day that yields zero sightings, so a legitimately empty result still counts
 * as "mined" and doesn't re-seed on every launch.
 *
 * Non-destructive — it never wipes user data; `TaskMiner.backfill` skips days
 * that already have sightings. A total failure or an unconfigured provider
 * records nothing, so the next launch simply retries.
 *
 * Must be called BEFORE capture resume: it synchronously claims miner priority
 * (see `setBackfillPending`) so the scheduled daily run stands down instead of
 * winning the shared settle delay and deferring the seed a whole launch.
 */
export async function runTaskBackfillIfNeeded(deps: TaskBackfillBootstrapDeps): Promise<void> {
  const { taskMiner, provider, storage } = deps

  // Already mined this DB → keep its sightings, skip the seed.
  if (storage.miningRuns.getLastRunTimestamp() !== null) return

  // Defer when there are no credentials yet — nothing is recorded, so the next
  // launch retries.
  if (!provider.isConfigured()) {
    log.info('[TaskMiner] One-time backfill deferred: no inference provider configured')
    return
  }

  // Claim priority synchronously (before awaiting, and before capture resume
  // arms the daily run) so the scheduled run stands down for this launch.
  taskMiner.setBackfillPending(true)
  try {
    const delayMs = deps.delayMs ?? PATTERN_DETECTION_CONFIG.SETTLE_DELAY_MS
    await new Promise((resolve) => setTimeout(resolve, delayMs))

    log.info(`[TaskMiner] Starting one-time ${TASK_BACKFILL.DAYS}-day sighting backfill`)
    const summary = await taskMiner.backfill(provider, { days: TASK_BACKFILL.DAYS })
    if (summary.skipped) {
      log.info(
        `[TaskMiner] One-time backfill did not run (${summary.skipped}); retrying next launch`,
      )
      return
    }
    log.info(
      `[TaskMiner] One-time backfill complete: ${summary.daysMined} mined, ` +
        `${summary.daysSkipped} already present, ${summary.daysFailed} failed`,
    )
  } catch (error) {
    log.error('[TaskMiner] One-time backfill failed; will retry next launch:', error)
  } finally {
    taskMiner.setBackfillPending(false)
  }
}
