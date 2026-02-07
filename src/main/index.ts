/**
 * MemoryLane - Main Process Entry Point
 *
 * Supports two modes:
 * - Recorder Mode (default): Full tray app with screenshot capture and processing
 * - MCP Server Mode (--mcp flag): Headless server for AI assistant integration
 */

// Detect MCP mode FIRST, before any heavy imports
const isMCPMode = process.argv.includes('--mcp')

// In MCP mode, capture the real stdout IMMEDIATELY and redirect process.stdout
// to stderr. The MCP stdio protocol owns stdout exclusively — this prevents ANY
// module (dotenv, native addons, etc.) from polluting the transport channel.
import { Writable } from 'node:stream'
let mcpStdout: Writable | undefined
if (isMCPMode) {
  const realWrite = process.stdout.write.bind(process.stdout)
  mcpStdout = new Writable({
    write(chunk, encoding, callback): void {
      realWrite(chunk, encoding as BufferEncoding, callback)
    },
  })
  process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write
}

import { app } from 'electron'
import log, { configureMCPMode } from './logger'

if (isMCPMode) {
  configureMCPMode()
}
import { EventProcessor } from './processor/index'
import { EmbeddingService } from './processor/embedding'
import { StorageService } from './processor/storage'
import { SemanticClassifierService } from './processor/semantic-classifier'
import { ApiKeyManager } from './settings/api-key-manager'
import { CaptureSettingsManager } from './settings/capture-settings-manager'
import { initSettingsIPC, initCaptureSettingsIPC } from './settings/settings-window'
import dotenv from 'dotenv'

try {
  dotenv.config()
} catch {
  // cwd might not be available in packaged app context — expected, we don't need .env there
}

// Prevent app from quitting when all windows are closed (tray app or MCP server)
app.on('window-all-closed', () => {
  // Don't quit - this is a tray app or MCP server
})

// macOS: Hide dock icon in MCP mode (headless)
if (process.platform === 'darwin' && isMCPMode) {
  app.dock?.hide()
}

if (isMCPMode) {
  // ============================================
  // MCP SERVER MODE
  // ============================================
  // Headless mode - no tray, no recorder, just search services

  app.on('ready', async () => {
    log.info('[MCP Mode] Starting MemoryLane MCP Server...')

    try {
      // Initialize API key manager for secure key storage
      const apiKeyManager = new ApiKeyManager()

      // Initialize only the services needed for search
      const embeddingService = new EmbeddingService()
      const storageService = new StorageService(StorageService.getDefaultDbPath())
      const classifierService = new SemanticClassifierService(
        apiKeyManager.getApiKey() || undefined,
      )
      const processor = new EventProcessor(embeddingService, storageService, classifierService)

      log.info('[MCP Mode] Services initialized')

      // Dynamically import MCP server to avoid loading it in recorder mode
      const { MemoryLaneMCPServer } = await import('./mcp/server')
      const mcpServer = new MemoryLaneMCPServer(processor)

      await mcpServer.start(undefined, mcpStdout)

      log.info('[MCP Mode] MCP Server started successfully')
    } catch (error) {
      log.error('[MCP Mode] Fatal error starting MCP server:', error)
      app.quit()
      process.exit(1)
    }
  })
} else {
  // ============================================
  // RECORDER MODE (Default)
  // ============================================
  // Full tray app with screenshot capture and processing

  // Dynamically import recorder modules only in recorder mode
  // This avoids loading heavy modules (OCR, interaction monitor) in MCP mode
  let recorder: typeof import('./recorder/recorder')
  let interactionMonitor: typeof import('./recorder/interaction-monitor')

  let processor: EventProcessor | null = null
  let apiKeyManager: ApiKeyManager | null = null
  let captureSettingsManager: CaptureSettingsManager | null = null

  const initRecorderMode = async () => {
    // Dynamic imports for recorder-specific modules
    recorder = await import('./recorder/recorder')
    interactionMonitor = await import('./recorder/interaction-monitor')
    const visualDetector = await import('./recorder/visual-detector')

    // Initialize API key manager for secure key storage
    apiKeyManager = new ApiKeyManager()

    // Initialize capture settings manager
    captureSettingsManager = new CaptureSettingsManager()

    // Initialize recorder modules with settings manager
    visualDetector.initVisualDetector(captureSettingsManager)
    interactionMonitor.initInteractionMonitor(captureSettingsManager)

    // Initialize Processor Services
    const embeddingService = new EmbeddingService()
    const storageService = new StorageService(StorageService.getDefaultDbPath())
    const classifierService = new SemanticClassifierService(apiKeyManager.getApiKey() || undefined)
    processor = new EventProcessor(embeddingService, storageService, classifierService)

    // Initialize settings IPC handlers (pass classifier so it can be updated when key changes)
    initSettingsIPC(apiKeyManager, classifierService)
    initCaptureSettingsIPC(captureSettingsManager)
  }

  // This method will be called when Electron has finished initialization
  app.on('ready', async () => {
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

    await initRecorderMode()

    const { setupTray } = await import('./ui/tray')
    setupTray({
      recorder,
      interactionMonitor,
      processor: processor!,
    })

    const { initMainWindowIPC, openMainWindow } = await import('./ui/main-window')
    initMainWindowIPC({
      recorder,
      interactionMonitor,
      processor: processor!,
    })
    openMainWindow()

    app.on('activate', () => {
      openMainWindow()
    })

    log.info('MemoryLane started. Screenshots will be saved to:', recorder.getScreenshotsDir())
  })
}
