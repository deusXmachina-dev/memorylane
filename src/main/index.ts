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
import { DeviceIdentity } from './settings/device-identity'
import { ManagedKeyService } from './services/managed-key-service'
import { DebugPipelineWriter } from './processor/debug-pipeline'
import { config as loadEnv } from 'dotenv'

try {
  loadEnv()
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

  let mcpServerInstance: {
    close?: () => Promise<void> | void
    getServer?: () => { close?: () => Promise<void> | void }
  } | null = null
  let mcpStorageService: StorageService | null = null
  let mcpEmbeddingService: EmbeddingService | null = null

  app.on('ready', async () => {
    log.info('[MCP Mode] Starting MemoryLane MCP Server...')
    DebugPipelineWriter.cleanDebugDir()

    try {
      // Initialize API key manager for secure key storage
      const apiKeyManager = new ApiKeyManager()

      // Initialize only the services needed for search
      mcpEmbeddingService = new EmbeddingService()
      mcpStorageService = new StorageService(StorageService.getDefaultDbPath())
      const classifierService = new SemanticClassifierService(
        apiKeyManager.getApiKey() || undefined,
      )
      const processor = new EventProcessor(mcpEmbeddingService, mcpStorageService, classifierService)

      log.info('[MCP Mode] Services initialized')

      // Dynamically import MCP server to avoid loading it in recorder mode
      const { MemoryLaneMCPServer } = await import('./mcp/server')
      const mcpServer = new MemoryLaneMCPServer(processor)
      mcpServerInstance = mcpServer

      await mcpServer.start(undefined, mcpStdout)

      log.info('[MCP Mode] MCP Server started successfully')
    } catch (error) {
      log.error('[MCP Mode] Fatal error starting MCP server:', error)
      app.quit()
      process.exit(1)
    }
  })

  // Cleanup handler for MCP mode
  app.on('before-quit', async (event) => {
    log.info('[MCP Mode] Shutting down MCP server...')

    // Prevent immediate quit to allow async cleanup
    event.preventDefault()

    try {
      // Close MCP server connection
      if (mcpServerInstance) {
        const server = mcpServerInstance.getServer?.() || mcpServerInstance
        if (server.close) {
          await server.close()
        }
      }

      // Close storage service (database connections)
      if (mcpStorageService) {
        await mcpStorageService.close()
      }

      log.info('[MCP Mode] Cleanup completed')
    } catch (error) {
      log.error('[MCP Mode] Error during cleanup:', error)
    } finally {
      // Now actually quit
      app.exit(0)
    }

    // Safety net: force-exit if graceful shutdown takes too long.
    // In-flight async work (embedding inference, API calls, database writes)
    // can keep the event loop alive indefinitely after app.quit().
    setTimeout(() => {
      log.warn('[MCP Mode] Graceful shutdown timed out — force exiting')
      app.exit(0)
    }, 3000).unref()
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
  let classifierService: SemanticClassifierService | null = null
  let managedKeyService: ManagedKeyService | null = null

  const initRecorderMode = async () => {
    // Dynamic imports for recorder-specific modules
    recorder = await import('./recorder/recorder')
    interactionMonitor = await import('./recorder/interaction-monitor')

    // Initialize API key manager for secure key storage
    apiKeyManager = new ApiKeyManager()

    // Initialize Processor Services
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

    // Initialize managed key service for subscription flow
    const deviceIdentity = new DeviceIdentity()
    managedKeyService = new ManagedKeyService(deviceIdentity)
  }

  // This method will be called when Electron has finished initialization
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

    await initRecorderMode()

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

    // If a managed key was provisioned while the app was closed, pick it up now
    void managedKeyService!.tryFetchKey()

    openMainWindow()

    // Wire up event handlers for screenshot processing and interaction monitoring
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
}
