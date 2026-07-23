import { unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { loadAppEditionConfig } from '@main/system/edition'
import log from '@main/utils/logger'

// The relaunch watchdog is a per-machine scheduled task owned by the MSI
// (registered by assets/watchdog-task.ps1, deleted on uninstall); the app
// cannot create or delete it unelevated. The app's lever is a per-user quit
// marker: the task's script (assets/watchdog-relaunch.vbs) skips the relaunch
// while the marker exists, so an explicit tray Quit holds until the next
// launch — login autostart or manual — clears it. The marker deliberately
// ignores the auto-start setting: that setting governs login behavior, while
// enterprise devices must recover from mid-session kills regardless.
export const QUIT_MARKER_FILENAME = 'watchdog-quit.marker'

function watchdogSupported(): boolean {
  return (
    process.platform === 'win32' &&
    app.isPackaged &&
    loadAppEditionConfig().edition === 'enterprise'
  )
}

function quitMarkerPath(): string {
  return path.join(app.getPath('userData'), QUIT_MARKER_FILENAME)
}

export async function enableWatchdog(): Promise<void> {
  if (!watchdogSupported()) {
    return
  }

  try {
    await unlink(quitMarkerPath())
    log.info('[Watchdog] Quit marker cleared — relaunch watchdog active')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('[Watchdog] Failed to clear quit marker:', error)
    }
  }
}

export async function disableWatchdog(): Promise<void> {
  if (!watchdogSupported()) {
    return
  }

  try {
    await writeFile(quitMarkerPath(), '')
    log.info('[Watchdog] Quit marker written — relaunch watchdog disabled')
  } catch (error) {
    log.warn('[Watchdog] Failed to write quit marker:', error)
  }
}
