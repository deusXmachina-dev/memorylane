/**
 * MemoryLane - Main Process Entry Point
 *
 * Full tray app with screenshot capture and processing.
 * The MCP server runs separately via mcp-entry.ts under ELECTRON_RUN_AS_NODE=1.
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import log from './logger'
import { ActivityProcessor } from './processor/index'
import { EmbeddingService } from './processor/embedding'
import { StorageService } from './processor/storage'
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
import { config as loadEnv } from 'dotenv'

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

  // Build endpoint config from saved custom endpoint (if any)
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

app.on('ready', async () => {
  DebugPipelineWriter.cleanDebugDir()

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

  await initServices()

  // Set up ActivityManager with recorder as capture provider
  activityManager = new ActivityManager({
    captureImmediate: recorder.captureImmediate,
    captureIfVisualChange: recorder.captureIfVisualChange,
    captureWindowByTitle: recorder.captureWindowByTitle,
  })

  const { setupTray, updateTrayMenu } = await import('./ui/tray')
  setupTray({
    recorder,
    activityManager: activityManager!,
    processor: processor!,
  })

  const { initMainWindowIPC, openMainWindow, sendStatusToRenderer } =
    await import('./ui/main-window')
  initMainWindowIPC({
    recorder,
    activityManager: activityManager!,
    processor: processor!,
    apiKeyManager: apiKeyManager!,
    customEndpointManager: customEndpointManager!,
    classifierService: classifierService!,
    managedKeyService: managedKeyService!,
  })

  const keySource = apiKeyManager!.getKeySource()
  if (keySource === 'none' || keySource === 'managed') {
    void managedKeyService!.tryFetchKey()
  }

  openMainWindow()

  // When an activity completes, enqueue it for processing (backpressure)
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

  // Route all interaction events through the ActivityManager
  interactionMonitor.onInteraction((event) => {
    void activityManager!.handleInteraction(event)
  })

  app.on('activate', () => {
    openMainWindow()
  })

  startPowerMonitoring({
    onPause: () => {
      // Force-close current activity before stopping capture
      if (activityManager) {
        void activityManager.forceClose()
      }
      if (recorder.isCapturingNow()) {
        log.info('[Main] Pausing capture (power state: locked/suspended)')
        recorder.stopCapture()
      }
    },
    onResume: () => {
      if (!recorder.isCapturingNow() && !shouldPause()) {
        log.info('[Main] Resuming capture (power state: active)')
        recorder.startCapture()
      }
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
