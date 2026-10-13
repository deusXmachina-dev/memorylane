// Sets process.env.PATH for onnxruntime DLLs on Windows. Must be the first
// import: onnxruntime-node loads transitively during static import resolution.
import '@main/system/onnxruntime-path-fix'

import { app, globalShortcut } from 'electron'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import {
  AUTO_START_HIDDEN_ARG,
  shouldStartHiddenOnLaunch,
  shouldSyncAutoStartOnStartup,
  syncAutoStartSetting,
} from '@main/system/auto-start'
import { createCaptureCoordinator } from '@main/capture/capture-orchestrator'
import { createCaptureHotkeyManager } from '@main/capture/capture-hotkey-manager'
import {
  createObservationController,
  type ObservationController,
} from '@main/capture/observation-controller'
import log from '@main/utils/logger'
import '@main/utils/logger-electron'
import { configureHttpTransport } from '@main/system/http-transport'
import { CaptureStateManager } from '@main/settings/capture-state-manager'
import { AppSettingsManager } from '@main/settings/app-settings-manager'
import { DeviceIdentity } from '@main/settings/device-identity'
import { VendorCredentialsManager } from '@main/settings/vendor-credentials-manager'
import { createMainRuntime, type MainRuntime } from '@main/runtime'
import { createSync, type AppSync } from '@main/sync'
import { registerEvalMediaScheme } from '@main/eval/eval-media-protocol'
import { getAppDirectoryName } from '@main/utils/paths'
import { loadAppEditionConfig } from '@main/system/edition'
import { initAutoUpdater } from '@main/system/updater'
import { setupTray } from '@main/ui/tray'
import {
  initMainWindowIPC,
  openMainWindow,
  sendObservationUpdate,
  sendUpdateState,
} from '@main/ui/main-window'

// Keep single-instance behavior in packaged app, but allow dev to run
// alongside production for local debugging.
if (app.isPackaged && !app.requestSingleInstanceLock()) {
  app.quit()
}

// Privileged schemes must be registered before `ready`.
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
let sync: AppSync | null = null
let observation: ObservationController | null = null

// Blocks `app.quit()` until all subscribers to native helpers have released
// them. Critical on Windows MSI upgrades: Electron's process is closed by
// RestartManager, but Rust helpers (app-watcher-windows.exe) aren't registered
// with it. If Electron exits before the observation controller and runtime
// release their app-watcher subscriptions, the helper outlives the main
// process, keeps an open handle on resources\rust\app-watcher-windows.exe,
// and MSI has to defer replacement to a reboot (return code 3010).
//
// A force-exit timer bounds shutdown at 5s (ahead of the mac preinstall's 10s
// SIGKILL) and logs which dispose steps were still pending. It is never
// cleared, so it also covers stray handles that outlive the graceful quit; a
// sync native call blocking the event loop still defeats it.
const SHUTDOWN_TIMEOUT_MS = 5_000
let shutdownStarted = false
let shutdownCompleted = false
app.on('before-quit', (event) => {
  if (shutdownCompleted) return
  event.preventDefault()
  // A repeated quit must not re-run dispose steps or arm a second timer; the
  // in-flight shutdown re-issues app.quit().
  if (shutdownStarted) return
  shutdownStarted = true

  observation?.dispose()

  const steps: Array<[name: string, step: Promise<unknown> | undefined]> = [
    ['runtime.dispose', runtime?.dispose()],
    ...(sync?.stop() ?? []),
  ]
  const pendingSteps = new Set(steps.filter(([, step]) => step).map(([name]) => name))

  setTimeout(() => {
    const pending = pendingSteps.size ? [...pendingSteps].join(', ') : 'none'
    log.error(
      `[Shutdown] Not exited after ${SHUTDOWN_TIMEOUT_MS}ms (pending: ${pending}) — forcing exit`,
    )
    shutdownCompleted = true
    app.exit(0)
  }, SHUTDOWN_TIMEOUT_MS).unref()

  void Promise.allSettled(
    steps.map(([name, step]) => step?.finally(() => pendingSteps.delete(name))),
  ).finally(() => {
    shutdownCompleted = true
    app.quit()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('second-instance', (_event, argv) => {
  // Background relaunches (login item, MSI launch task, LaunchAgent) that lose
  // the single-instance race pass --memorylane-hidden; only a real user launch
  // should surface the window.
  if (argv.includes(AUTO_START_HIDDEN_ARG)) return
  openMainWindow()
})

app.on('activate', () => {
  if (runtime) openMainWindow()
})

app.on('ready', async () => {
  configureHttpTransport()
  const editionConfig = loadAppEditionConfig()
  const { edition } = editionConfig

  const vendorCredentials = new VendorCredentialsManager()
  const settings = new AppSettingsManager({ edition })
  const captureState = new CaptureStateManager()
  settings.applyToConstants()

  if (shouldSyncAutoStartOnStartup(captureState.getAutoStartSyncedExecPath())) {
    syncAutoStartSetting(settings.get().autoStartEnabled)
    captureState.setAutoStartSyncedExecPath(process.execPath)
  }

  const rt = await createMainRuntime({
    edition,
    settings,
    vendorCredentials,
    deviceIdentity: new DeviceIdentity(),
  })
  runtime = rt
  sync = createSync(rt)

  const coordinator = createCaptureCoordinator({
    harness: rt.harness,
    captureStateManager: captureState,
    isPaused: () => rt.isPurging() || rt.host.shouldPause() || rt.requiresActivation(),
    userContextBuilder: rt.userContextBuilder,
    onStateChanged: () => rt.notifyStateChanged(),
  })
  const capture = coordinator.controls

  let activationBlocked = rt.requiresActivation()
  rt.accessProvider.addUpdateListener(() => {
    const blocked = rt.requiresActivation()
    if (blocked === activationBlocked) return
    activationBlocked = blocked
    if (blocked) coordinator.suspendCapture('device not activated')
    else coordinator.resumeCaptureIfDesired('reactivated')
  })

  const hotkey = createCaptureHotkeyManager({
    platform: process.platform,
    onTriggered: (accelerator) => {
      if (capture.isUserPaused()) {
        capture.resumeCapture()
        log.info(`[Main] Capture resumed from pause by hotkey (${accelerator})`)
      } else if (capture.isCapturingNow()) {
        capture.requestStopCapture()
        log.info(`[Main] Capture stopped by hotkey (${accelerator})`)
      } else {
        capture.requestStartCapture()
        log.info(`[Main] Capture started by hotkey (${accelerator})`)
      }
    },
  })

  observation = createObservationController({
    captureControl: rt.harness,
    onUpdate: (state) => sendObservationUpdate(state),
  })

  setupTray({ runtime: rt, capture })

  if (edition === 'customer') {
    initAutoUpdater(() => {
      rt.notifyStateChanged()
      sendUpdateState()
    })
  } else {
    log.info('[Updater] Skipping auto-updater for enterprise edition')
  }

  initMainWindowIPC({ editionConfig, runtime: rt, sync, capture, hotkey, observation })

  rt.start()
  sync.start()
  coordinator.resumeCaptureIfDesired('startup')

  if (!shouldStartHiddenOnLaunch()) openMainWindow()

  const hotkeyResult = hotkey.reconfigure(settings.get().captureHotkeyAccelerator)
  if (hotkeyResult.success) rt.notifyStateChanged()
  else log.warn(hotkeyResult.error)

  rt.host.start((pause) => {
    if (pause) coordinator.suspendCapture('power state: locked/suspended')
    else coordinator.resumeCaptureIfDesired('resume')
  })

  log.info(
    `[Startup] MemoryLane v${app.getVersion()} (${edition} edition, ${app.isPackaged ? 'packaged' : 'dev'})`,
  )
})
