import * as fs from 'fs'
import * as path from 'path'
import log from '@main/utils/logger'
import { TASK_BACKFILL } from '../../../shared/constants'

/**
 * Persistent, one-time-completion marker for the task-mining backfill.
 *
 * Lives in its own `{userData}/task-backfill.json` file (not capture-settings)
 * so the one-time upgrade migration doesn't ride along in user settings. Gated
 * by `TASK_BACKFILL.VERSION`: bump the constant to force a re-backfill for
 * everyone. Fresh installs simply have no file yet — their first backfill is a
 * near-no-op (no history to mine) that then stamps the marker.
 */
export interface BackfillMarker {
  /** True once a backfill at (or above) the current version has completed. */
  isComplete(): boolean
  /** Stamp completion at the current version. */
  markComplete(): void
}

interface MarkerFile {
  version?: number
  completedAt?: number
}

export function createBackfillMarker(userDataPath: string): BackfillMarker {
  const filePath = path.join(userDataPath, 'task-backfill.json')
  return {
    isComplete(): boolean {
      try {
        if (!fs.existsSync(filePath)) return false
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as MarkerFile
        return (data.version ?? 0) >= TASK_BACKFILL.VERSION
      } catch (error) {
        // A corrupt/unreadable marker is treated as incomplete: worst case the
        // backfill re-runs, and its per-day skip keeps that cheap.
        log.warn('[TaskMiner] Failed to read backfill marker; treating as incomplete:', error)
        return false
      }
    },
    markComplete(): void {
      const data: MarkerFile = { version: TASK_BACKFILL.VERSION, completedAt: Date.now() }
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
    },
  }
}
