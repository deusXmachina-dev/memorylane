/**
 * MemoryLane - Main Process Entry Point
 *
 * Full tray app running exclusively on the v2 timeline-first pipeline.
 * The MCP server runs separately via mcp-entry.ts under ELECTRON_RUN_AS_NODE=1.
 */

import { app } from 'electron'
import { config as loadEnv } from 'dotenv'
import {
  canSyncAutoStartSetting,
  shouldStartHiddenOnLaunch,
  syncAutoStartSetting,
} from './auto-start'
import { createCaptureCoordinator } from './capture-orchestrator'
import log from './logger'
import { startPowerMonitoring, shouldPause } from './power-monitor'
import { CaptureStateManager } from './settings/capture-state-manager'
import { CaptureSettingsManager } from './settings/capture-settings-manager'
import { PatternDetector } from './services/pattern-detector'
import { createV2MainRuntime, type V2MainRuntime } from './v2/runtime'

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

try {
  loadEnv()
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

let runtime: V2MainRuntime | null = null
let patternDetector: PatternDetector | null = null

app.on('before-quit', () => {
  if (!runtime) return
  void runtime.dispose()
})

app.on('second-instance', () => {
  void import('./ui/main-window').then(({ openMainWindow }) => {
    openMainWindow()
  })
})

app.on('ready', async () => {
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
  captureSettingsManager.applyToConstants()

  if (!captureStateManager.isAutoStartInitialized() && canSyncAutoStartSetting()) {
    syncAutoStartSetting(captureSettingsManager.get().autoStartEnabled)
    captureStateManager.setAutoStartInitialized(true)
  }

  const { setupTray, updateTrayMenu } = await import('./ui/tray')
  const { initMainWindowIPC, openMainWindow, sendStatusToRenderer } =
    await import('./ui/main-window')

  runtime = await createV2MainRuntime({
    onCaptureStateChanged: () => {
      void updateTrayMenu()
      void sendStatusToRenderer()
    },
    semanticPipelinePreference: captureSettingsManager.get().semanticPipelineMode,
  })

  patternDetector = new PatternDetector(runtime.storage, runtime.apiKeyManager)
  const captureCoordinator = createCaptureCoordinator({
    capture: runtime.capture,
    captureStateManager,
    isPaused: shouldPause,
    patternDetector,
  })

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
  })

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

  log.info(
    'MemoryLane started (v2 pipeline). Frame output dir:',
    runtime.capture.getScreenshotsDir(),
  )
})
