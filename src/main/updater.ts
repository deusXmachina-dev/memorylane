import { app, Notification } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from './logger'

export type UpdateState = 'idle' | 'downloading' | 'ready'
let state: UpdateState = 'idle'
let reminderInterval: ReturnType<typeof setInterval> | null = null
// Must be kept in module scope so the click handler isn't garbage-collected.
let currentNotification: Notification | null = null
const DISABLE_AUTO_UPDATE_ENV_VAR = 'MEMORYLANE_DISABLE_AUTO_UPDATE'

export const getUpdateState = (): UpdateState => state

const isAutoUpdateDisabled = (): boolean => {
  const rawValue = process.env[DISABLE_AUTO_UPDATE_ENV_VAR]
  if (!rawValue) return false

  const normalizedValue = rawValue.trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(normalizedValue)
}

export const quitAndInstall = (): void => {
  if (reminderInterval) {
    clearInterval(reminderInterval)
    reminderInterval = null
  }
  log.info('[Updater] Requesting quit-and-install')
  // isForceRunAfter=true is required for tray apps that have no main window,
  // otherwise the quit sequence can stall.
  autoUpdater.quitAndInstall(false, true)

  // Safety net: electron-updater may silently not quit the app (e.g. if the
  // downloaded update helper was GC'd, or the native Squirrel quit stalls in
  // a tray-only app with no windows to close). Force-terminate after a grace
  // period — ShipIt (Squirrel.Mac) only needs the process to die before it
  // can copy the new version and relaunch.
  // Intentionally NOT .unref()'d so this keeps the event loop alive.
  setTimeout(() => {
    log.warn('[Updater] App still running after quitAndInstall — forcing exit')
    app.exit(0)
  }, 3_000)
}

const showUpdateNotification = (version: string): void => {
  if (currentNotification) currentNotification.close()
  currentNotification = new Notification({
    title: 'MemoryLane Update Ready',
    body: `Version ${version} is ready. Click to restart and update.`,
    silent: true,
  })
  currentNotification.on('click', () => quitAndInstall())
  currentNotification.show()
}

export const initAutoUpdater = (onUpdateStateChange: () => void): void => {
  if (!app.isPackaged) {
    log.info('[Updater] Skipping in dev mode')
    return
  }

  if (isAutoUpdateDisabled()) {
    state = 'idle'
    log.info(
      `[Updater] Auto-update disabled via ${DISABLE_AUTO_UPDATE_ENV_VAR}; skipping updater initialization.`,
    )
    onUpdateStateChange()
    return
  }

  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    log.info(`[Updater] Update available: ${info.version}`)
    state = 'downloading'
    onUpdateStateChange()
  })

  autoUpdater.on('update-downloaded', (info) => {
    log.info(`[Updater] Update downloaded: ${info.version}`)
    state = 'ready'
    onUpdateStateChange()

    showUpdateNotification(info.version)

    if (reminderInterval) clearInterval(reminderInterval)
    reminderInterval = setInterval(() => showUpdateNotification(info.version), 4 * 60 * 60 * 1000)
  })

  autoUpdater.on('update-not-available', () => {
    state = 'idle'
    log.info('[Updater] Up to date.')
  })

  autoUpdater.on('error', (err) => {
    log.error('[Updater] Error:', err)
  })

  setTimeout(() => void autoUpdater.checkForUpdates(), 10_000)
  setInterval(() => void autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000)
}
