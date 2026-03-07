/**
 * MemoryLane - Main Process Entry Point
 *
 * Tray app running the timeline-first pipeline.
 * The MCP server runs separately via mcp-entry.ts under ELECTRON_RUN_AS_NODE=1.
 */

import { app, globalShortcut } from 'electron'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import {
  canSyncAutoStartSetting,
  shouldStartHiddenOnLaunch,
  syncAutoStartSetting,
} from './auto-start'
import { createCaptureCoordinator } from './capture-orchestrator'
import { createCaptureHotkeyManager } from './capture-hotkey-manager'
import log from './logger'
import './logger-electron'
import { startPowerMonitoring, shouldPause } from './power-monitor'
import { CaptureStateManager } from './settings/capture-state-manager'
import { CaptureSettingsManager } from './settings/capture-settings-manager'
import { SlackIntegrationService } from './integrations/slack/service'
import { SlackSettingsManager } from './integrations/slack/settings-manager'
import { SlackSemanticLayer } from './integrations/slack/semantic'
import { PatternDetector } from './services/pattern-detector'
import { createMainRuntime, type MainRuntime } from './runtime'
import { getAppDirectoryName } from './paths'

// Keep single-instance behavior in packaged app, but allow dev to run
// alongside production for local debugging.
if (app.isPackaged && !app.requestSingleInstanceLock()) {
  app.quit()
}

try {
  if (!app.isPackaged) {
    loadEnv()
  }
} catch {
  // cwd might not be available in packaged app context — expected, we don't need .env there
}

// Hide dock icon on macOS for pure tray experience
if (process.platform === 'darwin') {
  app.dock?.hide()
}

// Prevent app from quitting when all windows are closed (tray app)
app.on('window-all-closed', () => {
  // Don't quit - this is a tray app
})

let runtime: MainRuntime | null = null
let patternDetector: PatternDetector | null = null
let slackIntegrationService: SlackIntegrationService | null = null

app.on('before-quit', () => {
  void Promise.all([runtime?.dispose(), slackIntegrationService?.stop()])
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('second-instance', () => {
  void import('./ui/main-window').then(({ openMainWindow }) => {
    openMainWindow()
  })
})

app.on('ready', async () => {
  if (!app.isPackaged) {
    const devUserDataPath = path.join(app.getPath('appData'), getAppDirectoryName(true))
    if (app.getPath('userData') !== devUserDataPath) {
      app.setPath('userData', devUserDataPath)
    }
  }

  const startHidden = shouldStartHiddenOnLaunch()

  try {
    const { ensurePermissions } = await import('./ui/permissions')
    await ensurePermissions()
  } catch (error) {
    log.error('[Startup] Fatal error during permissions check:', error)
    const { dialog } = await import('electron')
    await dialog.showMessageBox({
      type: 'error',
      title: 'Startup Error',
      message: 'Failed to verify permissions',
      detail:
        'An unexpected error occurred while checking permissions. ' +
        'Please try restarting the app. If the problem persists, check the logs.',
    })
    app.quit()
    return
  }

  const captureSettingsManager = new CaptureSettingsManager()
  const captureStateManager = new CaptureStateManager()
  const slackSettingsManager = new SlackSettingsManager()
  captureSettingsManager.applyToConstants()
  const initialCaptureSettings = captureSettingsManager.get()

  if (!captureStateManager.isAutoStartInitialized() && canSyncAutoStartSetting()) {
    syncAutoStartSetting(initialCaptureSettings.autoStartEnabled)
    captureStateManager.setAutoStartInitialized(true)
  }

  const { setupTray, updateTrayMenu } = await import('./ui/tray')
  const { initMainWindowIPC, openMainWindow, sendStatusToRenderer } =
    await import('./ui/main-window')

  runtime = await createMainRuntime({
    onCaptureStateChanged: () => {
      void updateTrayMenu()
      void sendStatusToRenderer()
    },
    semanticPipelinePreference: initialCaptureSettings.semanticPipelineMode,
    semanticRequestTimeoutMs: initialCaptureSettings.semanticRequestTimeoutMs,
    excludedApps: initialCaptureSettings.excludedApps,
    excludedWindowTitlePatterns: initialCaptureSettings.excludedWindowTitlePatterns,
    excludedUrlPatterns: initialCaptureSettings.excludedUrlPatterns,
    excludePrivateBrowsing: initialCaptureSettings.excludePrivateBrowsing,
  })

  slackIntegrationService = new SlackIntegrationService(
    slackSettingsManager,
    new SlackSemanticLayer({
      activities: runtime.storage.activities,
      apiKeyManager: runtime.apiKeyManager,
    }),
  )

  patternDetector = new PatternDetector(runtime.storage, runtime.apiKeyManager)
  const captureCoordinator = createCaptureCoordinator({
    capture: runtime.capture,
    captureStateManager,
    isPaused: shouldPause,
    patternDetector,
  })

  const hotkeyManager = createCaptureHotkeyManager({
    platform: process.platform,
    onTriggered: (accelerator) => {
      if (captureCoordinator.controls.isCapturingNow()) {
        captureCoordinator.controls.requestStopCapture()
        log.info(`[Main] Capture stopped by hotkey (${accelerator})`)
      } else {
        captureCoordinator.controls.requestStartCapture()
        log.info(`[Main] Capture started by hotkey (${accelerator})`)
      }
      void updateTrayMenu()
      void sendStatusToRenderer()
    },
  })

  const reconfigureCaptureHotkey = (accelerator: string): { success: boolean; error?: string } => {
    const result = hotkeyManager.reconfigure(accelerator)
    if (!result.success) return result

    log.info(`[Main] Registered capture hotkey: ${hotkeyManager.getAccelerator()}`)
    void updateTrayMenu()
    void sendStatusToRenderer()
    return result
  }

  setupTray({
    capture: captureCoordinator.controls,
    storage: runtime.storage,
  })

  const { initAutoUpdater } = await import('./updater')
  initAutoUpdater(() => {
    void updateTrayMenu()
  })

  initMainWindowIPC({
    capture: captureCoordinator.controls,
    storage: runtime.storage,
    usageTracker: runtime.usageTracker,
    apiKeyManager: runtime.apiKeyManager,
    customEndpointManager: runtime.customEndpointManager,
    semanticService: runtime.semanticService,
    managedKeyService: runtime.managedKeyService,
    captureSettingsManager,
    slackSettingsManager,
    slackIntegrationService,
    getCaptureHotkeyLabel: hotkeyManager.getLabel,
    reconfigureCaptureHotkey,
    updateExclusions: (exclusions) => runtime?.updateExclusions(exclusions),
  })

  await slackIntegrationService.reload()

  const keySource = runtime.apiKeyManager.getKeySource()
  if (keySource === 'none' || keySource === 'managed') {
    void runtime.managedKeyService.tryFetchKey()
  }

  captureCoordinator.resumeCaptureIfDesired('startup')

  if (!startHidden) {
    openMainWindow()
  }

  app.on('activate', () => {
    openMainWindow()
  })

  const hotkeyResult = reconfigureCaptureHotkey(
    captureSettingsManager.get().captureHotkeyAccelerator,
  )
  if (!hotkeyResult.success) {
    log.warn(hotkeyResult.error)
  }

  startPowerMonitoring({
    onPause: () => {
      if (!runtime?.capture.isCapturingNow()) return

      void runtime.capture.forceClose()
      log.info('[Main] Pausing capture (power state: locked/suspended)')
      runtime.capture.stopCapture()
    },
    onResume: () => {
      captureCoordinator.resumeCaptureIfDesired('resume')
    },
  })

  log.info('MemoryLane started. Frame output dir:', runtime.capture.getScreenshotsDir())
})
