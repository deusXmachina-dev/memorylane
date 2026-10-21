import * as fs from 'fs'
import * as path from 'path'
import log from '@main/utils/logger'
import { SCREENSHOT_CLEANUP_CONFIG } from '@constants'
import type { Activity } from './activity-types'

// Async on purpose: rmSync's retries sleep synchronously on Windows, blocking
// the main process for seconds whenever a frame is briefly locked.
async function deleteFileIfPresent(filepath: string, label: 'frame' | 'video'): Promise<boolean> {
  try {
    await fs.promises.rm(filepath, { force: true, maxRetries: 5, retryDelay: 100 })
    return fs.existsSync(filepath) === false
  } catch {
    log.debug(`[ActivityCleanup] Failed to delete ${label}: ${filepath}`)
    return false
  }
}

export async function cleanupActivityFiles(
  activity: Activity,
  videoOutputDir: string,
): Promise<void> {
  const results = await Promise.all([
    ...activity.frames.map((activityFrame) =>
      deleteFileIfPresent(activityFrame.frame.filepath, 'frame'),
    ),
    deleteFileIfPresent(`${videoOutputDir}/${activity.id}.mp4`, 'video'),
  ])
  const deleted = results.filter(Boolean).length

  if (deleted > 0) {
    log.info(`[ActivityCleanup] Deleted ${deleted} file(s) for activity ${activity.id}`)
  }
}

export function sweepStaleFiles(outputDir: string): void {
  const now = Date.now()
  let deleted = 0
  let skipped = 0
  try {
    for (const file of fs.readdirSync(outputDir)) {
      if (!file.endsWith('.png') && !file.endsWith('.jpg') && !file.endsWith('.mp4')) continue
      const filepath = path.join(outputDir, file)
      try {
        if (now - fs.statSync(filepath).mtimeMs > SCREENSHOT_CLEANUP_CONFIG.MAX_AGE_MS) {
          fs.unlinkSync(filepath)
          deleted++
        }
      } catch {
        skipped++
      }
    }
  } catch (err) {
    log.warn('[ActivityCleanup] File cleanup sweep failed:', err)
  }
  if (deleted > 0) log.info(`[ActivityCleanup] Swept ${deleted} stale file(s)`)
  if (skipped > 0) {
    log.warn(`[ActivityCleanup] Skipped ${skipped} file(s) during sweep (stat/unlink failed)`)
  }
}
