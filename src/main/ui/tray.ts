/**
 * System tray management for MemoryLane
 */

import { app, Tray, Menu, nativeImage } from 'electron'
import path from 'node:path'
import log from '../logger'
import { formatBytes, formatNumber } from '../utils/formatters'
import type { StorageService } from '../storage'
import { openMainWindow } from './main-window'
import { getUpdateState, quitAndInstall } from '../updater'
import { createTrayPrivacyState } from './tray-privacy-state'
import { CAPTURE_PAUSE_CONFIG, formatPauseDuration } from '../../shared/constants'

interface TrayDependencies {
  capture: {
    isCapturingNow: () => boolean
    requestStartCapture: () => void
    requestStopCapture: () => void
    pauseCapture: (durationMs: number) => void
    resumeCapture: () => void
    getPauseState: () => { pausedUntilMs: number | null }
    stopCaptureForShutdown: () => void
    forceClose: () => Promise<void>
  }
  storage: StorageService
}

// Tray menus are static once set; while paused we periodically rebuild so the
// "resumes in N min" countdown stays roughly fresh if the user opens the menu.
const PAUSE_REFRESH_MS = 30_000
let pauseRefreshTimer: ReturnType<typeof setTimeout> | null = null

const clearPauseRefreshTimer = (): void => {
  if (pauseRefreshTimer) {
    clearTimeout(pauseRefreshTimer)
    pauseRefreshTimer = null
  }
}

const formatRemaining = (pausedUntilMs: number): string => {
  const remainingMs = Math.max(0, pausedUntilMs - Date.now())
  const minutes = Math.ceil(remainingMs / 60_000)
  return minutes <= 1 ? 'less than a minute' : `~${minutes} min`
}

let tray: Tray | null = null
let deps: TrayDependencies | null = null
const trayPrivacyState = createTrayPrivacyState({
  onRecentlyBlockedExpired: () => {
    void updateTrayMenu()
  },
})

export const setPrivacyBlockedState = (blocked: boolean): void => {
  trayPrivacyState.setBlocked(blocked)
  void updateTrayMenu()
}

app.on('before-quit', () => {
  trayPrivacyState.dispose()
  clearPauseRefreshTimer()

  if (tray) {
    tray.destroy()
    tray = null
  }

  // Safety net: force-exit if graceful shutdown takes too long.
  // In-flight async work (OCR subprocesses, embedding inference, API calls)
  // can keep the event loop alive indefinitely after app.quit().
  setTimeout(() => {
    log.warn('[Quit] Graceful shutdown timed out — force exiting')
    app.exit(0)
  }, 3000).unref()
})

/**
 * Build the usage stats submenu with API and storage statistics
 */
const buildUsageStatsSubmenu = async (): Promise<Electron.MenuItemConstructorOptions[]> => {
  const submenu: Electron.MenuItemConstructorOptions[] = []

  if (!deps?.storage) {
    submenu.push({
      label: 'Stats not available',
      enabled: false,
    })
    return submenu
  }

  try {
    const activityCount = deps.storage.activities.count()
    const dbSize = deps.storage.getDbSize()

    submenu.push(
      {
        label: `Activities: ${formatNumber(activityCount)}`,
        enabled: false,
      },
      {
        label: `Database: ${formatBytes(dbSize)}`,
        enabled: false,
      },
    )
  } catch (error) {
    log.error('Error fetching storage stats:', error)
    submenu.push({
      label: 'Storage stats unavailable',
      enabled: false,
    })
  }

  return submenu
}

/**
 * Build the capture-control menu items for the current state:
 * - paused: a status line + "Resume Capture Now"
 * - capturing: flat "Pause for 15/30/60 min" presets, then "Turn off capture"
 * - off: "Start Capture"
 */
const buildCaptureMenuItems = (state: {
  isCapturing: boolean
  isUserPaused: boolean
  pausedUntilMs: number | null
}): Electron.MenuItemConstructorOptions[] => {
  // Click handlers only invoke a coordinator control; the resulting
  // onStateChanged refreshes the tray menu and renderer.
  if (state.isUserPaused && state.pausedUntilMs !== null) {
    return [
      { label: `Paused — resumes ${formatRemaining(state.pausedUntilMs)}`, enabled: false },
      {
        label: 'Resume Capture Now',
        click: () => deps!.capture.resumeCapture(),
      },
    ]
  }

  if (state.isCapturing) {
    return [
      // Pause is the default action — presets sit flat at the top level.
      ...CAPTURE_PAUSE_CONFIG.PRESETS_MINUTES.map((minutes) => ({
        label: `Pause for ${formatPauseDuration(minutes)}`,
        click: () => deps!.capture.pauseCapture(minutes * 60_000),
      })),
      { type: 'separator' as const },
      // Turning capture off entirely is the secondary, de-emphasized option.
      {
        label: 'Turn off capture',
        click: () => deps!.capture.requestStopCapture(),
      },
    ]
  }

  return [
    {
      label: 'Start Capture',
      click: () => deps!.capture.requestStartCapture(),
    },
  ]
}

/**
 * Update the tray context menu with current state
 */
export const updateTrayMenu = async (): Promise<void> => {
  if (!tray || !deps) return

  const isCapturing = deps.capture.isCapturingNow()
  const { pausedUntilMs } = deps.capture.getPauseState()
  const isUserPaused = pausedUntilMs !== null
  const { isPrivacyBlocked, blockedRecently } = trayPrivacyState.getStatus(isCapturing)

  // Keep the countdown label fresh while paused; stop refreshing otherwise.
  clearPauseRefreshTimer()
  if (isUserPaused) {
    pauseRefreshTimer = setTimeout(() => {
      pauseRefreshTimer = null
      void updateTrayMenu()
    }, PAUSE_REFRESH_MS)
    pauseRefreshTimer.unref?.()
  }

  const versionSuffix = ` (v${app.getVersion()})`
  tray.setToolTip(
    isUserPaused
      ? `MemoryLane - Capture Paused (resumes ${formatRemaining(pausedUntilMs)})${versionSuffix}`
      : isPrivacyBlocked
        ? `MemoryLane - Capture Paused (Privacy Rule)${versionSuffix}`
        : blockedRecently
          ? `MemoryLane - Capture Recently Paused (Privacy Rule)${versionSuffix}`
          : `MemoryLane - Screen Capture${versionSuffix}`,
  )

  const usageStatsSubmenu = await buildUsageStatsSubmenu()

  const updateState = getUpdateState()
  const contextMenu = Menu.buildFromTemplate([
    ...(updateState === 'ready'
      ? [
          { label: 'Install Update Now (Restart)', click: () => void quitAndInstall() },
          { type: 'separator' as const },
        ]
      : updateState === 'downloading'
        ? [{ label: 'Downloading Update...', enabled: false }, { type: 'separator' as const }]
        : []),
    ...(isPrivacyBlocked
      ? [
          {
            label: 'Capture paused: privacy rule matched',
            enabled: false,
          },
          { type: 'separator' as const },
        ]
      : blockedRecently
        ? [
            {
              label: 'Capture recently paused: privacy rule matched',
              enabled: false,
            },
            { type: 'separator' as const },
          ]
        : []),
    ...buildCaptureMenuItems({ isCapturing, isUserPaused, pausedUntilMs }),
    { type: 'separator' },
    {
      label: 'Usage Stats',
      submenu: usageStatsSubmenu,
    },
    { label: `MemoryLane v${app.getVersion()}`, enabled: false },
    {
      label: 'Open MemoryLane',
      click: () => {
        openMainWindow()
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        void deps!.capture.forceClose()
        deps!.capture.stopCaptureForShutdown()
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)
}
/**
 * Setup the system tray with icon, tooltip, and menu
 */
export const setupTray = (dependencies: TrayDependencies): void => {
  deps = dependencies

  const isDev = !app.isPackaged
  const iconPath = isDev
    ? path.join(app.getAppPath(), 'assets', 'tray-icon.png')
    : path.join(process.resourcesPath, 'assets', 'tray-icon.png')
  let icon: Electron.NativeImage

  try {
    icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) {
      icon = nativeImage.createEmpty()
    }
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)

  void updateTrayMenu()
}
