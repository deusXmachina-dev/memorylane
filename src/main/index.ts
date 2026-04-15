/**
 * MemoryLane - Main Process Entry Point
 *
 * Tray app running the timeline-first pipeline.
 * The MCP server is provided by the CLI package (@deusxmachina-dev/memorylane-cli).
 */

// Side-effect import: sets process.env.PATH for onnxruntime DLLs on Windows.
// Must be the first import — onnxruntime-node is loaded transitively via
// runtime → embedding → @huggingface/transformers during static import resolution.
import './onnxruntime-path-fix'

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
import { DeviceIdentity } from './settings/device-identity'
import { migrateOldMcpEntries } from './integrations'
import { PatternDetector } from './services/pattern-detector'
import { UserContextBuilder } from './services/user-context-builder'
import { RawDatabaseExportSync } from './services/raw-database-export-sync'
import { DatabaseUploadSync } from './services/database-upload-sync'
import { createMainRuntime, type MainRuntime } from './runtime'
import { getAppDirectoryName } from './paths'
import { loadAppEditionConfig } from './edition'
import { ENTERPRISE_BACKEND_CONFIG } from '../shared/constants'

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

// In dev, point all Electron services at MemoryLane-dev before app ready.
// If set after ready, Chromium network cache can initialize with an invalid path sandbox state.
if (!app.isPackaged) {
  const devUserDataPath = path.join(app.getPath('appData'), getAppDirectoryName(true))
  if (app.getPath('userData') !== devUserDataPath) {
    app.setPath('userData', devUserDataPath)
  }
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
let userContextBuilder: UserContextBuilder | null = null
let patternDetector: PatternDetector | null = null
let rawDatabaseExportSync: RawDatabaseExportSync | null = null
let databaseUploadSync: DatabaseUploadSync | null = null

app.on('before-quit', () => {
  runtime?.accessProvider.stopPeriodicRefresh()
  void Promise.all([runtime?.dispose(), rawDatabaseExportSync?.stop(), databaseUploadSync?.stop()])
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
  migrateOldMcpEntries()
  const startHidden = shouldStartHiddenOnLaunch()
  const editionConfig = loadAppEditionConfig()

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
  const deviceIdentity = new DeviceIdentity()
  captureSettingsManager.applyToConstants()
  const initialCaptureSettings = captureSettingsManager.get()

  if (!captureStateManager.isAutoStartInitialized() && canSyncAutoStartSetting()) {
    syncAutoStartSetting(initialCaptureSettings.autoStartEnabled)
    captureStateManager.setAutoStartInitialized(true)
  }

  const { setupTray, updateTrayMenu, setPrivacyBlockedState } = await import('./ui/tray')
  const { initMainWindowIPC, openMainWindow, sendStatusToRenderer } =
    await import('./ui/main-window')

  runtime = await createMainRuntime({
    edition: editionConfig.edition,
    onCaptureStateChanged: () => {
      void updateTrayMenu()
      void sendStatusToRenderer()
    },
    onPrivacyBlockingChanged: setPrivacyBlockedState,
    semanticPipelinePreference: initialCaptureSettings.semanticPipelineMode,
    semanticRequestTimeoutMs: initialCaptureSettings.semanticRequestTimeoutMs,
    excludedApps: initialCaptureSettings.excludedApps,
    excludedWindowTitlePatterns: initialCaptureSettings.excludedWindowTitlePatterns,
    excludedUrlPatterns: initialCaptureSettings.excludedUrlPatterns,
    excludePrivateBrowsing: initialCaptureSettings.excludePrivateBrowsing,
    deviceIdentity,
  })

  rawDatabaseExportSync = new RawDatabaseExportSync({
    storage: runtime.storage,
    getExportDirectory: () => captureSettingsManager.get().databaseExportDirectory,
    getInstallationId: () => deviceIdentity.getPublicInstallationId(),
  })
  rawDatabaseExportSync.start()

  if (editionConfig.edition === 'enterprise') {
    databaseUploadSync = new DatabaseUploadSync({
      storage: runtime.storage,
      getDeviceId: () => deviceIdentity.getDeviceId(),
      isActivated: () => runtime?.accessProvider.getAccessState().isEnterpriseActivated ?? false,
      getStripOptions: () => ({ detailLevel: captureSettingsManager.get().uploadDetailLevel }),
      backendUrl: ENTERPRISE_BACKEND_CONFIG.BACKEND_URL,
    })
    databaseUploadSync.start()
  }

  userContextBuilder = new UserContextBuilder(runtime.storage, runtime.apiKeyManager)
  patternDetector = new PatternDetector(runtime.storage, runtime.apiKeyManager)
  patternDetector.setEnabled(captureSettingsManager.get().patternDetectionEnabled)
  const captureCoordinator = createCaptureCoordinator({
    capture: runtime.capture,
    captureStateManager,
    isPaused: shouldPause,
    userContextBuilder,
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

  if (editionConfig.edition === 'customer') {
    const { initAutoUpdater } = await import('./updater')
    initAutoUpdater(() => {
      void updateTrayMenu()
    })
  } else {
    log.info('[Updater] Skipping auto-updater for enterprise edition')
  }

  initMainWindowIPC({
    editionConfig,
    capture: captureCoordinator.controls,
    storage: runtime.storage,
    usageTracker: runtime.usageTracker,
    apiKeyManager: runtime.apiKeyManager,
    customEndpointManager: runtime.customEndpointManager,
    semanticService: runtime.semanticService,
    accessProvider: runtime.accessProvider,
    captureSettingsManager,
    patternDetector: patternDetector ?? undefined,
    getCaptureHotkeyLabel: hotkeyManager.getLabel,
    reconfigureCaptureHotkey,
    updateExclusions: (exclusions) => runtime?.updateExclusions(exclusions),
    databaseExportSync: rawDatabaseExportSync,
    databaseUploadSync: databaseUploadSync ?? undefined,
  })

  runtime.accessProvider.startPeriodicRefresh()

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

  log.info(`[Startup] Running ${editionConfig.edition} edition`)
  log.info('MemoryLane started. Frame output dir:', runtime.capture.getScreenshotsDir())
})
