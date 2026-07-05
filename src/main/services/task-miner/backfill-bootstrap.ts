import log from '@main/utils/logger'
import type { InferenceProvider } from '@main/llm'
import type { CaptureSettingsManager } from '@main/settings/capture-settings-manager'
import { PATTERN_DETECTION_CONFIG, TASK_BACKFILL } from '../../../shared/constants'
import type { TaskMiner } from '.'

export interface TaskBackfillBootstrapDeps {
  taskMiner: TaskMiner
  provider: InferenceProvider
  settings: Pick<CaptureSettingsManager, 'get' | 'save'>
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
 * Version-gated via `taskBackfillVersion` in capture-settings.json (mirrors the
 * `migrateAppTokens` one-time-upgrade idiom): completion is stamped only on
 * success, so a failure or an unconfigured provider simply retries on a later
 * launch. Non-destructive — it never wipes user data; `TaskMiner.backfill` skips
 * days that already have sightings.
 */
export async function runTaskBackfillIfNeeded(deps: TaskBackfillBootstrapDeps): Promise<void> {
  const { taskMiner, provider, settings } = deps

  if ((settings.get().taskBackfillVersion ?? 0) >= TASK_BACKFILL.VERSION) return

  // Defer without stamping when there are no credentials yet — retry next launch.
  if (!provider.isConfigured()) {
    log.info('[TaskMiner] One-time backfill deferred: no inference provider configured')
    return
  }

  const delayMs = deps.delayMs ?? PATTERN_DETECTION_CONFIG.SETTLE_DELAY_MS
  await new Promise((resolve) => setTimeout(resolve, delayMs))

  try {
    log.info(`[TaskMiner] Starting one-time ${TASK_BACKFILL.DAYS}-day sighting backfill`)
    const summary = await taskMiner.backfill(provider, { days: TASK_BACKFILL.DAYS })
    if (summary.skipped) {
      log.info(
        `[TaskMiner] One-time backfill did not run (${summary.skipped}); retrying next launch`,
      )
      return
    }
    settings.save({ taskBackfillVersion: TASK_BACKFILL.VERSION })
    log.info(
      `[TaskMiner] One-time backfill complete: ${summary.daysMined} mined, ` +
        `${summary.daysSkipped} already present, ${summary.daysFailed} failed`,
    )
  } catch (error) {
    log.error('[TaskMiner] One-time backfill failed; will retry next launch:', error)
  }
}
