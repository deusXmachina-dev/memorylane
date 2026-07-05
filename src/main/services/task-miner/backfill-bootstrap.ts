import log from '@main/utils/logger'
import type { InferenceProvider } from '@main/llm'
import { PATTERN_DETECTION_CONFIG, TASK_BACKFILL } from '../../../shared/constants'
import type { TaskMiner } from '.'
import type { BackfillMarker } from './backfill-marker'

export interface TaskBackfillBootstrapDeps {
  taskMiner: TaskMiner
  provider: InferenceProvider
  /** Persistent one-time-completion marker (`{userData}/task-backfill.json`). */
  marker: BackfillMarker
  /** Settle delay before the backfill starts; defaults to the miner settle delay. */
  delayMs?: number
}

/**
 * Run the one-time task-mining backfill once per user, in the background.
 *
 * When a user upgrades to the build that drops the old pattern tables, their new
 * sightings/clusters tables would otherwise be empty until ~30 days of daily
 * runs accumulate. This seeds them from the history already in their DB.
 *
 * Completion is tracked in a dedicated marker file (see `BackfillMarker`) and
 * stamped only on success, so a failure or an unconfigured provider simply
 * retries on a later launch. Non-destructive — it never wipes user data;
 * `TaskMiner.backfill` skips days that already have sightings.
 *
 * The backfill and the startup daily run share the same settle delay, so a naive
 * background start races the scheduled run and usually loses (deferring the seed
 * a whole launch). To avoid that, this **synchronously** marks the miner's
 * backfill as pending before it awaits — so the scheduled run armed by capture
 * resume stands down and lets the backfill seed the tables unopposed. Call it
 * BEFORE capture resume for the pending flag to be seen.
 */
export async function runTaskBackfillIfNeeded(deps: TaskBackfillBootstrapDeps): Promise<void> {
  const { taskMiner, provider, marker } = deps

  if (marker.isComplete()) return

  // Defer without stamping when there are no credentials yet — retry next launch.
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
    // Don't stamp if any day failed — a failed day wrote no sightings, so leaving
    // the marker unset lets the next launch re-mine just the gaps (hasInWindow
    // skips the days that succeeded).
    if (summary.daysFailed > 0) {
      log.warn(
        `[TaskMiner] One-time backfill left ${summary.daysFailed} day(s) unmined ` +
          `(${summary.daysMined} mined, ${summary.daysSkipped} already present); ` +
          `will retry the gaps next launch`,
      )
      return
    }
    marker.markComplete()
    log.info(
      `[TaskMiner] One-time backfill complete: ${summary.daysMined} mined, ` +
        `${summary.daysSkipped} already present`,
    )
  } catch (error) {
    log.error('[TaskMiner] One-time backfill failed; will retry next launch:', error)
  } finally {
    taskMiner.setBackfillPending(false)
  }
}
