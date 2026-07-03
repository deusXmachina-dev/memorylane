/**
 * MemoryLane - Main Process Entry Point
 *
 * Tray app running the timeline-first pipeline.
 * The MCP server is provided by the CLI package (@deusxmachina-dev/memorylane-cli).
 */

// Side-effect import: sets process.env.PATH for onnxruntime DLLs on Windows.
// Must be the first import — onnxruntime-node is loaded transitively via
// runtime → embedding → @huggingface/transformers during static import resolution.
import '@main/system/onnxruntime-path-fix'

import { app, globalShortcut } from 'electron'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import {
  canSyncAutoStartSetting,
  shouldStartHiddenOnLaunch,
  syncAutoStartSetting,
} from '@main/system/auto-start'
import { createCaptureCoordinator } from '@main/capture/capture-orchestrator'
import { createCaptureHotkeyManager } from '@main/capture/capture-hotkey-manager'
import log from '@main/utils/logger'
import '@main/utils/logger-electron'
import { startPowerMonitoring, shouldPause } from '@main/monitoring/power-monitor'
import { CaptureStateManager } from './settings/capture-state-manager'
import { CaptureSettingsManager } from './settings/capture-settings-manager'
import { DeviceIdentity } from './settings/device-identity'
import { listInstalledApps } from './apps/installed-apps'
import { VendorCredentialsManager } from './settings/vendor-credentials-manager'
import { PatternDetector } from './services/pattern-detector'
import { TaskMiner } from './services/task-miner'
import { TASK_MINING_ENABLED } from '@main/system/feature-flags'
import { UserContextBuilder } from './services/user-context-builder'
import { RawDatabaseExportSync } from './services/raw-database-export-sync'
import { DatabaseUploadSync } from './services/database-upload-sync'
import { LogUploadSync } from './services/log-upload-sync'
import { readLogUploadState, writeLogUploadState } from './services/log-upload-store'
import { RemoteBlacklistService } from './services/remote-blacklist-service'
import { readRemoteBlacklist, writeRemoteBlacklist } from './services/remote-blacklist-store'
import { DeviceReportSync } from './services/device-report-sync'
import { readDeviceReportState, writeDeviceReportState } from './services/device-report-store'
import { createMainRuntime, type MainRuntime } from './runtime'
import { registerEvalMediaScheme, registerEvalMediaProtocol } from './eval/eval-media-protocol'
import {
  createObservationController,
  type ObservationController,
} from '@main/capture/observation-controller'
import { getAppDirectoryName } from '@main/utils/paths'
import { loadAppEditionConfig } from '@main/system/edition'
import { ENTERPRISE_BACKEND_CONFIG, MANAGED_KEY_CONFIG } from '../shared/constants'

// Keep single-instance behavior in packaged app, but allow dev to run
// alongside production for local debugging.
if (app.isPackaged && !app.requestSingleInstanceLock()) {
  app.quit()
}

// Privileged scheme for streaming eval review videos — must be registered
// before the app `ready` event (the handler is wired after the runtime exists).
registerEvalMediaScheme()

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

// Capture otherwise-unlogged crashes so they reach main.log for support bundles.
// electron-log's file transport only records calls made through the logger, so
// without these a fatal main-process error would leave no trace at the moment it
// matters most.
//
// An uncaught exception leaves the process in an undefined state; Node's docs are
// explicit that it's not safe to resume. We log and then exit with Node's default
// failure code so the tray crashes rather than limping on with capture silently
// dead. electron-log's file transport writes synchronously, so the line is on
// disk before we exit.
process.on('uncaughtException', (error) => {
  log.error('[Crash] Uncaught exception in main process:', error)
  process.exit(1)
})
// A stray rejection (e.g. a failed background fetch) is usually non-fatal, so we
// log and keep capturing rather than take down the tray.
process.on('unhandledRejection', (reason) => {
  log.error('[Crash] Unhandled promise rejection in main process:', reason)
})
app.on('render-process-gone', (_event, _webContents, details) => {
  const line = `[Crash] Renderer process gone (reason=${details.reason}, exitCode=${details.exitCode})`
  // A clean exit is a normal window teardown, not a crash.
  if (details.reason === 'clean-exit') log.debug(line)
  else log.error(line)
})
app.on('child-process-gone', (_event, details) => {
  // Utility processes (e.g. the upload-prep worker) exit cleanly by design —
  // only an abnormal departure is worth a line.
  if (details.reason === 'clean-exit') return
  log.warn(
    `[Crash] Child process gone (type=${details.type}, reason=${details.reason}, exitCode=${details.exitCode})`,
  )
})

// Prevent app from quitting when all windows are closed (tray app)
app.on('window-all-closed', () => {
  // Don't quit - this is a tray app
})

let runtime: MainRuntime | null = null
let userContextBuilder: UserContextBuilder | null = null
let patternDetector: PatternDetector | null = null
let taskMiner: TaskMiner | null = null
let rawDatabaseExportSync: RawDatabaseExportSync | null = null
let databaseUploadSync: DatabaseUploadSync | null = null
let logUploadSync: LogUploadSync | null = null
let remoteBlacklist: RemoteBlacklistService | null = null
let deviceReportSync: DeviceReportSync | null = null
let observation: ObservationController | null = null

// Blocks `app.quit()` until all subscribers to native helpers have released
// them. Critical on Windows MSI upgrades: Electron's process is closed by
// RestartManager, but Rust helpers (app-watcher-windows.exe) aren't registered
// with it. If Electron exits before the observation controller and runtime
// release their app-watcher subscriptions, the helper outlives the main
// process, keeps an open handle on resources\rust\app-watcher-windows.exe,
// and MSI has to defer replacement to a reboot (return code 3010).
let shutdownCompleted = false
app.on('before-quit', (event) => {
  if (shutdownCompleted) return
  event.preventDefault()

  runtime?.accessProvider.stopPeriodicRefresh()
  remoteBlacklist?.stop()
  deviceReportSync?.stop()
  observation?.dispose()

  void Promise.allSettled([
    runtime?.dispose(),
    rawDatabaseExportSync?.stop(),
    databaseUploadSync?.stop(),
    logUploadSync?.stop(),
  ]).finally(() => {
    shutdownCompleted = true
    app.quit()
  })
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
  const startHidden = shouldStartHiddenOnLaunch()
  const editionConfig = loadAppEditionConfig()

  // Permissions are no longer blocking at startup. The renderer drives the
  // permission grant flow as part of onboarding (PermissionsStep).

  const vendorCredentialsManager = new VendorCredentialsManager()
  const captureSettingsManager = new CaptureSettingsManager({ edition: editionConfig.edition })
  // First-launch migration from legacy custom-endpoint config.
  if (vendorCredentialsManager.migration.hadCustomEndpoint) {
    if (captureSettingsManager.get().activeVendor === 'openrouter') {
      captureSettingsManager.setActiveVendor('openai-compatible')
      log.info('[Main] migrated activeVendor to openai-compatible from legacy custom-endpoint')
    }
    const carriedModel = vendorCredentialsManager.migration.customEndpointModel
    if (carriedModel && captureSettingsManager.get().activeVendor === 'openai-compatible') {
      // Pre-PR custom endpoints stored a single model id used wherever the
      // custom endpoint was hit. Restore it into every slot so the user's
      // prior choice survives — they can re-pick per slot afterwards.
      captureSettingsManager.save({
        semanticSnapshotModel: carriedModel,
        patternDetectionModel: carriedModel,
      })
      log.info(
        `[Main] restored legacy custom-endpoint model into snapshot+pattern slots: ${carriedModel}`,
      )
    }
  }
  // First-launch upgrade of pre-v1 excluded-app tokens to bundle ids. Must run
  // before initialCaptureSettings is read below so the runtime starts with the
  // migrated tokens.
  await captureSettingsManager.migrateAppTokens(listInstalledApps)
  const captureStateManager = new CaptureStateManager()
  const deviceIdentity = new DeviceIdentity()
  captureSettingsManager.applyToConstants()
  const initialCaptureSettings = captureSettingsManager.get()

  if (!captureStateManager.isAutoStartInitialized() && canSyncAutoStartSetting()) {
    syncAutoStartSetting(initialCaptureSettings.autoStartEnabled)
    captureStateManager.setAutoStartInitialized(true)
  }

  const { setupTray, updateTrayMenu, setPrivacyBlockedState } = await import('./ui/tray')
  const { initMainWindowIPC, openMainWindow, sendStatusToRenderer, sendManagedExclusionsUpdate } =
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
    excludedUrlPatterns: initialCaptureSettings.excludedUrlPatterns,
    excludePrivateBrowsing: initialCaptureSettings.excludePrivateBrowsing,
    deviceIdentity,
    vendorCredentials: vendorCredentialsManager,
    getActiveVendor: () => captureSettingsManager.get().activeVendor,
    initialVideoModel: initialCaptureSettings.semanticVideoModel,
    initialSnapshotModel: initialCaptureSettings.semanticSnapshotModel,
  })

  // Serve eval review videos from the fixtures dir (Developer mode).
  registerEvalMediaProtocol(runtime.evalFixturesRoot)

  rawDatabaseExportSync = new RawDatabaseExportSync({
    storage: runtime.storage,
    getExportDirectory: () => captureSettingsManager.get().databaseExportDirectory,
    getInstallationId: () => deviceIdentity.getPublicInstallationId(),
  })
  rawDatabaseExportSync.start()

  // Report the running app version in both editions so the fleet's version
  // distribution is visible server-side. Picks the per-edition backend base URL.
  const reportBackendUrl =
    editionConfig.edition === 'enterprise'
      ? ENTERPRISE_BACKEND_CONFIG.BACKEND_URL
      : MANAGED_KEY_CONFIG.BACKEND_URL
  deviceReportSync = new DeviceReportSync({
    getDeviceId: () => deviceIdentity.getDeviceId(),
    isActivated:
      editionConfig.edition === 'enterprise'
        ? () => runtime?.accessProvider.getAccessState().isEnterpriseActivated ?? false
        : () => true,
    getBackendUrl: () => reportBackendUrl,
    getVersion: () => app.getVersion(),
    edition: editionConfig.edition,
    readStored: () => readDeviceReportState(),
    writeStored: (state) => writeDeviceReportState(state),
  })
  deviceReportSync.start()

  if (editionConfig.edition === 'enterprise') {
    databaseUploadSync = new DatabaseUploadSync({
      storage: runtime.storage,
      getDeviceId: () => deviceIdentity.getDeviceId(),
      isActivated: () => runtime?.accessProvider.getAccessState().isEnterpriseActivated ?? false,
      isSyncEnabled: () => captureSettingsManager.get().uploadDetailLevel !== 'off',
      getStripOptions: () => {
        const level = captureSettingsManager.get().uploadDetailLevel
        return { detailLevel: level === 'detailed' ? 'detailed' : 'summary' }
      },
      getBackendUrl: () => ENTERPRISE_BACKEND_CONFIG.BACKEND_URL,
      getLastUploadAt: () => runtime?.storage.uploadRuns.getLastRunTimestamp() ?? null,
      recordUploadAt: (ts) => runtime?.storage.uploadRuns.record(ts),
    })
    databaseUploadSync.start()

    logUploadSync = new LogUploadSync({
      getDeviceId: () => deviceIdentity.getDeviceId(),
      isActivated: () => runtime?.accessProvider.getAccessState().isEnterpriseActivated ?? false,
      isSyncEnabled: () => captureSettingsManager.get().uploadDetailLevel !== 'off',
      getBackendUrl: () => ENTERPRISE_BACKEND_CONFIG.BACKEND_URL,
      readState: () => readLogUploadState(),
      writeState: (state) => writeLogUploadState(state),
    })
    logUploadSync.start()

    remoteBlacklist = new RemoteBlacklistService({
      getDeviceId: () => deviceIdentity.getDeviceId(),
      isActivated: () => runtime?.accessProvider.getAccessState().isEnterpriseActivated ?? false,
      getBackendUrl: () => ENTERPRISE_BACKEND_CONFIG.BACKEND_URL,
      onChange: (blacklist) => {
        runtime?.setManagedExclusions(blacklist)
        sendManagedExclusionsUpdate()
      },
      readStored: () => readRemoteBlacklist(),
      writeStored: (blacklist) => writeRemoteBlacklist(blacklist),
    })
    remoteBlacklist.start()
  }

  userContextBuilder = new UserContextBuilder(runtime.storage, runtime.inferenceProvider)
  userContextBuilder.updateModel(captureSettingsManager.get().patternDetectionModel)
  // ML_TASK_MINING (dev flag) swaps the scheduled miner: when ON, the new
  // TaskMiner runs INSTEAD of the PatternDetector. When OFF (default), the
  // existing pattern detector runs exactly as before — nothing changes.
  if (TASK_MINING_ENABLED) {
    log.info('[Main] ML_TASK_MINING=1 — scheduling TaskMiner instead of PatternDetector')
    taskMiner = new TaskMiner(runtime.storage, runtime.inferenceProvider)
    taskMiner.setEnabled(captureSettingsManager.get().patternDetectionEnabled)
    taskMiner.updateModel(captureSettingsManager.get().patternDetectionModel)
  } else {
    patternDetector = new PatternDetector(runtime.storage, runtime.inferenceProvider)
    patternDetector.setEnabled(captureSettingsManager.get().patternDetectionEnabled)
    patternDetector.updateModel(captureSettingsManager.get().patternDetectionModel)
  }
  const scheduledMiner = patternDetector ?? taskMiner
  const captureCoordinator = createCaptureCoordinator({
    capture: runtime.capture,
    captureStateManager,
    isPaused: shouldPause,
    userContextBuilder,
    patternDetector: scheduledMiner,
    onStateChanged: () => {
      void updateTrayMenu()
      void sendStatusToRenderer()
    },
  })

  const hotkeyManager = createCaptureHotkeyManager({
    platform: process.platform,
    onTriggered: (accelerator) => {
      if (captureCoordinator.controls.isUserPaused()) {
        captureCoordinator.controls.resumeCapture()
        log.info(`[Main] Capture resumed from pause by hotkey (${accelerator})`)
      } else if (captureCoordinator.controls.isCapturingNow()) {
        captureCoordinator.controls.requestStopCapture()
        log.info(`[Main] Capture stopped by hotkey (${accelerator})`)
      } else {
        captureCoordinator.controls.requestStartCapture()
        log.info(`[Main] Capture started by hotkey (${accelerator})`)
      }
      // Tray + renderer are refreshed by the coordinator's onStateChanged.
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
    const { initAutoUpdater } = await import('@main/system/updater')
    const { sendUpdateState } = await import('./ui/main-window')
    initAutoUpdater(() => {
      void updateTrayMenu()
      sendUpdateState()
    })
  } else {
    log.info('[Updater] Skipping auto-updater for enterprise edition')
  }

  const { sendObservationUpdate } = await import('./ui/main-window')

  observation = createObservationController({
    captureControl: runtime.capture,
    onUpdate: (state) => sendObservationUpdate(state),
  })

  initMainWindowIPC({
    editionConfig,
    capture: captureCoordinator.controls,
    storage: runtime.storage,
    usageTracker: runtime.usageTracker,
    vendorCredentials: runtime.vendorCredentials,
    inferenceProvider: runtime.inferenceProvider,
    semanticService: runtime.semanticService,
    accessProvider: runtime.accessProvider,
    captureSettingsManager,
    patternDetector: scheduledMiner ?? undefined,
    userContextBuilder: userContextBuilder ?? undefined,
    getCaptureHotkeyLabel: hotkeyManager.getLabel,
    reconfigureCaptureHotkey,
    updateExclusions: (exclusions) => runtime?.updateExclusions(exclusions),
    getManagedExclusions: () => remoteBlacklist?.getBlacklist() ?? { apps: [], urlPatterns: [] },
    databaseExportSync: rawDatabaseExportSync,
    databaseUploadSync: databaseUploadSync ?? undefined,
    logUploadSync: logUploadSync ?? undefined,
    purgeAll: () => runtime?.purgeAll() ?? Promise.reject(new Error('Runtime not initialized')),
    observation,
    evalRecorder: runtime.evalRecorder,
    evalFixtureStore: runtime.evalFixtureStore,
    taskFixtureStore: runtime.taskFixtureStore,
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
      // Catch up uploads on wake — the 24h interval doesn't survive sleep.
      databaseUploadSync?.scheduleUploadIfStale('resume')
      logUploadSync?.requestSync('resume')
    },
  })

  log.info(
    `[Startup] MemoryLane v${app.getVersion()} (${editionConfig.edition} edition, ${app.isPackaged ? 'packaged' : 'dev'})`,
  )
  log.info('MemoryLane started. Frame output dir:', runtime.capture.getScreenshotsDir())
})
