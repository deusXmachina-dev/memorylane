import * as fs from 'fs'
import * as path from 'path'
import log from '@main/utils/logger'
import { SCREENSHOT_CLEANUP_CONFIG } from '@constants'
import type { Activity } from './activity-types'

function deleteFileIfPresent(filepath: string, label: 'frame' | 'video'): boolean {
  try {
    fs.rmSync(filepath, { force: true })
    return fs.existsSync(filepath) === false
  } catch {
    log.warn(`[ActivityCleanup] Failed to delete ${label}: ${filepath}`)
    return false
  }
}

export function cleanupActivityFiles(activity: Activity, videoOutputDir: string): void {
  let deleted = 0

  for (const activityFrame of activity.frames) {
    if (deleteFileIfPresent(activityFrame.frame.filepath, 'frame')) {
      deleted++
    }
  }

  const videoPath = `${videoOutputDir}/${activity.id}.mp4`
  if (deleteFileIfPresent(videoPath, 'video')) {
    deleted++
  }

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
