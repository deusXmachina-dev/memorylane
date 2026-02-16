/**
 * MemoryLane - Main Process Entry Point
 *
 * Full tray app with screenshot capture and processing.
 * The MCP server runs separately via mcp-entry.ts under ELECTRON_RUN_AS_NODE=1.
 */

import { app } from 'electron'
import log from './logger'
import { EventProcessor } from './processor/index'
import { EmbeddingService } from './processor/embedding'
import { StorageService } from './processor/storage'
import { SemanticClassifierService } from './processor/semantic-classifier'
import { ApiKeyManager } from './settings/api-key-manager'
import { DeviceIdentity } from './settings/device-identity'
import { ManagedKeyService } from './services/managed-key-service'
import { DebugPipelineWriter } from './processor/debug-pipeline'
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

let processor: EventProcessor | null = null
let apiKeyManager: ApiKeyManager | null = null
let classifierService: SemanticClassifierService | null = null
let managedKeyService: ManagedKeyService | null = null

const initServices = async (): Promise<void> => {
  recorder = await import('./recorder/recorder')
  interactionMonitor = await import('./recorder/interaction-monitor')

  apiKeyManager = new ApiKeyManager()

  const embeddingService = new EmbeddingService()
  const storageService = new StorageService(StorageService.getDefaultDbPath())
  const debugWriter = DebugPipelineWriter.create()
  classifierService = new SemanticClassifierService(
    apiKeyManager.getApiKey() || undefined,
    undefined,
    undefined,
    undefined,
    debugWriter,
  )
  processor = new EventProcessor(embeddingService, storageService, classifierService)

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

  const { setupTray, updateTrayMenu } = await import('./ui/tray')
  setupTray({
    recorder,
    interactionMonitor,
    processor: processor!,
  })

  const { initMainWindowIPC, openMainWindow, sendStatusToRenderer } =
    await import('./ui/main-window')
  initMainWindowIPC({
    recorder,
    interactionMonitor,
    processor: processor!,
    apiKeyManager: apiKeyManager!,
    classifierService: classifierService!,
    managedKeyService: managedKeyService!,
  })

  void managedKeyService!.tryFetchKey()

  openMainWindow()

  recorder.onScreenshot(async (screenshot) => {
    log.info(`[Main] Screenshot captured: ${screenshot.id}`)
    try {
      await processor!.processScreenshot(screenshot)
      log.info(`[Main] Screenshot processed successfully: ${screenshot.id}`)
      void updateTrayMenu()
      void sendStatusToRenderer()
    } catch (error) {
      log.error(`[Main] Error processing screenshot ${screenshot.id}:`, error)
    }
  })

  interactionMonitor.onInteraction((event) => {
    processor!.addInteractionEvent(event)
  })

  app.on('activate', () => {
    openMainWindow()
  })

  log.info('MemoryLane started. Screenshots will be saved to:', recorder.getScreenshotsDir())
})
