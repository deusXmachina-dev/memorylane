/**
 * MemoryLane - Main Process Entry Point
 *
 * Full tray app with screenshot capture and processing.
 * The MCP server runs separately via mcp-entry.ts under ELECTRON_RUN_AS_NODE=1.
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { config as loadEnv } from 'dotenv'
import { shouldStartHiddenOnLaunch } from './auto-start'
import { createCaptureCoordinator } from './capture-orchestrator'
import log from './logger'
import { ActivityProcessor } from './processor/index'
import { EmbeddingService } from './processor/embedding'
import { StorageService } from './storage'
import { SemanticClassifierService } from './processor/semantic-classifier'
import { ApiKeyManager } from './settings/api-key-manager'
import { CustomEndpointManager } from './settings/custom-endpoint-manager'
import { DeviceIdentity } from './settings/device-identity'
import { ManagedKeyService } from './services/managed-key-service'
import { DebugPipelineWriter } from './processor/debug-pipeline'
import { ActivityManager } from './processor/activity-manager'
import { ProcessingQueue } from './processor/processing-queue'
import { startPowerMonitoring, shouldPause } from './power-monitor'
import { SCREENSHOT_CLEANUP_CONFIG } from '../shared/constants'
import { CaptureStateManager } from './settings/capture-state-manager'
import { CaptureSettingsManager } from './settings/capture-settings-manager'

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

try {
  loadEnv()
} catch {
  // cwd might not be available in packaged app context - expected, we don't need .env there
}

if (process.platform === 'darwin') {
  app.dock?.hide()
}

app.on('window-all-closed', () => {
  // Don't quit - this is a tray app
})

let recorder: typeof import('./recorder/recorder')
let interactionMonitor: typeof import('./recorder/interaction-monitor')

let processor: ActivityProcessor | null = null
let activityManager: ActivityManager | null = null
let apiKeyManager: ApiKeyManager | null = null
let customEndpointManager: CustomEndpointManager | null = null
let classifierService: SemanticClassifierService | null = null
let managedKeyService: ManagedKeyService | null = null

const initServices = async (): Promise<void> => {
  recorder = await import('./recorder/recorder')
  interactionMonitor = await import('./recorder/interaction-monitor')

  apiKeyManager = new ApiKeyManager()
  customEndpointManager = new CustomEndpointManager()

  const embeddingService = new EmbeddingService()
  const storageService = new StorageService(StorageService.getDefaultDbPath())
  const debugWriter = DebugPipelineWriter.create()

  const savedEndpoint = customEndpointManager.getEndpoint()
  const endpointConfig = savedEndpoint
    ? {
        serverURL: savedEndpoint.serverURL,
        apiKey: savedEndpoint.apiKey,
        model: savedEndpoint.model,
      }
    : undefined

  classifierService = new SemanticClassifierService(
    apiKeyManager.getApiKey() || undefined,
    undefined,
    undefined,
    undefined,
    debugWriter,
    endpointConfig,
  )
  processor = new ActivityProcessor(embeddingService, storageService, classifierService)

  const deviceIdentity = new DeviceIdentity()
  managedKeyService = new ManagedKeyService(deviceIdentity)
}

app.on('second-instance', () => {
  void import('./ui/main-window').then(({ openMainWindow }) => {
    openMainWindow()
  })
})

app.on('ready', async () => {
  DebugPipelineWriter.cleanDebugDir()
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

  await initServices()

  activityManager = new ActivityManager({
    captureImmediate: recorder.captureImmediate,
    captureIfVisualChange: recorder.captureIfVisualChange,
    captureWindowByTitle: recorder.captureWindowByTitle,
  })

  const captureCoordinator = createCaptureCoordinator({
    recorder,
    activityManager: activityManager!,
    captureStateManager,
    isPaused: shouldPause,
  })

  const { setupTray, updateTrayMenu } = await import('./ui/tray')
  setupTray({
    capture: captureCoordinator.controls,
    processor: processor!,
  })

  const { initAutoUpdater } = await import('./updater')
  initAutoUpdater(() => {
    void updateTrayMenu()
  })

  const { initMainWindowIPC, openMainWindow, sendStatusToRenderer } =
    await import('./ui/main-window')
  initMainWindowIPC({
    capture: captureCoordinator.controls,
    processor: processor!,
    apiKeyManager: apiKeyManager!,
    customEndpointManager: customEndpointManager!,
    classifierService: classifierService!,
    managedKeyService: managedKeyService!,
    captureSettingsManager,
  })

  const keySource = apiKeyManager!.getKeySource()
  if (keySource === 'none' || keySource === 'managed') {
    void managedKeyService!.tryFetchKey()
  }

  captureCoordinator.resumeCaptureIfDesired('startup')

  if (!startHidden) {
    openMainWindow()
  }

  const processingQueue = new ProcessingQueue((activity) => processor!.processActivity(activity))

  activityManager.onActivityComplete((activity) => {
    log.info(`[Main] Activity completed: ${activity.id} (${activity.appName})`)
    void processingQueue
      .enqueue(activity)
      .then(() => {
        log.info(`[Main] Activity processed successfully: ${activity.id}`)
        void updateTrayMenu()
        void sendStatusToRenderer()
      })
      .catch((error) => {
        log.error(`[Main] Error processing activity ${activity.id}:`, error)
      })
  })

  interactionMonitor.onInteraction((event) => {
    void activityManager!.handleInteraction(event)
  })

  app.on('activate', () => {
    openMainWindow()
  })

  startPowerMonitoring({
    onPause: () => {
      if (captureCoordinator.controls.isCapturingNow()) {
        void captureCoordinator.controls.forceClose()
        log.info('[Main] Pausing capture (power state: locked/suspended)')
        captureCoordinator.controls.stopCaptureForShutdown()
      }
    },
    onResume: () => {
      captureCoordinator.resumeCaptureIfDesired('resume')
    },
  })

  const screenshotsDir = recorder.getScreenshotsDir()
  setInterval(() => {
    const now = Date.now()
    let deleted = 0
    try {
      for (const file of fs.readdirSync(screenshotsDir)) {
        const filepath = path.join(screenshotsDir, file)
        try {
          if (now - fs.statSync(filepath).mtimeMs > SCREENSHOT_CLEANUP_CONFIG.MAX_AGE_MS) {
            fs.unlinkSync(filepath)
            deleted++
          }
        } catch {
          // ignore per-file errors
        }
      }
    } catch (err) {
      log.warn('[Main] Screenshot cleanup failed:', err)
    }
    if (deleted > 0) log.info(`[Main] Deleted ${deleted} old screenshot(s)`)
  }, SCREENSHOT_CLEANUP_CONFIG.CLEANUP_INTERVAL_MS)

  log.info('MemoryLane started. Screenshots will be saved to:', screenshotsDir)
})
