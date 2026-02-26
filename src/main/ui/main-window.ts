/**
 * Main application window for MemoryLane
 *
 * Provides a visible control surface alongside the system tray.
 * Singleton window that hides on close instead of destroying.
 */

import { app, BrowserWindow, dialog, ipcMain, IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as yazl from 'yazl'
import log from '../logger'
import { updateTrayMenu } from './tray'
import { registerWithClaudeDesktop } from '../integrations/claude-desktop'
import { registerWithCursor } from '../integrations/cursor'
import { registerWithClaudeCode } from '../integrations/claude-code'
import type { ApiKeyManager } from '../settings/api-key-manager'
import type { CustomEndpointManager } from '../settings/custom-endpoint-manager'
import type { ManagedKeyService } from '../services/managed-key-service'
import type {
  DatabaseExportResult,
  CustomEndpointConfig,
  MainWindowStats,
  CaptureSettings,
  SubscriptionPlan,
} from '../../shared/types'
import type { CaptureSettingsManager } from '../settings/capture-settings-manager'
import type { StorageService } from '../storage'
import type { UsageTracker } from '../services/usage-tracker'

interface SemanticService {
  updateApiKey(apiKey: string | null): void
  updateEndpoint(config: CustomEndpointConfig | null, openRouterKey?: string | null): void
}

interface MainWindowDependencies {
  capture: {
    isCapturingNow: () => boolean
    startCapture: () => void
    stopCapture: () => void
    forceClose: () => Promise<void>
  }
  storage: StorageService
  usageTracker: UsageTracker
  apiKeyManager: ApiKeyManager
  customEndpointManager: CustomEndpointManager
  semanticService: SemanticService
  managedKeyService: ManagedKeyService
  captureSettingsManager: CaptureSettingsManager
}

interface MainWindowStatus {
  capturing: boolean
}

let mainWindow: BrowserWindow | null = null
let deps: MainWindowDependencies | null = null
let isQuitting = false

app.on('before-quit', () => {
  isQuitting = true
})

function buildStatus(): MainWindowStatus {
  return {
    capturing: deps?.capture.isCapturingNow() ?? false,
  }
}

function pad2(v: number): string {
  return String(v).padStart(2, '0')
}

function buildDefaultDatabaseExportFilename(now = new Date()): string {
  const timestamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(
    now.getHours(),
  )}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  return `memorylane-db-export-${timestamp}.zip`
}

function ensureZipExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith('.zip') ? filePath : `${filePath}.zip`
}

async function createZipWithSingleFile(
  inputPath: string,
  entryName: string,
  outputZipPath: string,
): Promise<void> {
  await fsPromises.mkdir(path.dirname(outputZipPath), { recursive: true })

  await new Promise<void>((resolve, reject) => {
    const zipFile = new yazl.ZipFile()
    const output = fs.createWriteStream(outputZipPath)

    const onError = (error: unknown): void => {
      reject(error instanceof Error ? error : new Error(String(error)))
    }

    output.once('error', onError)
    zipFile.outputStream.once('error', onError)
    output.once('close', resolve)

    zipFile.outputStream.pipe(output)
    zipFile.addFile(inputPath, entryName)
    zipFile.end()
  })
}

async function exportDatabaseZip(): Promise<DatabaseExportResult> {
  if (!deps) {
    return { success: false, error: 'Dependencies not initialized' }
  }

  let tempDir: string | null = null
  let outputPath: string | null = null

  try {
    const defaultPath = path.join(
      app.getPath('documents'),
      buildDefaultDatabaseExportFilename(new Date()),
    )
    const saveResult = await dialog.showSaveDialog(getMainWindow() ?? undefined, {
      title: 'Export Database ZIP',
      defaultPath,
      buttonLabel: 'Export',
      filters: [{ name: 'ZIP Archives', extensions: ['zip'] }],
    })

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, cancelled: true }
    }

    outputPath = ensureZipExtension(saveResult.filePath)
    tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'memorylane-db-export-'))
    const dbBasename = path.basename(deps.storage.getDbPath())
    const backupPath = path.join(tempDir, dbBasename)

    await deps.storage.backupToFile(backupPath)
    await createZipWithSingleFile(backupPath, dbBasename, outputPath)

    return { success: true, outputPath }
  } catch (error) {
    log.error('[MainWindow] Error exporting database ZIP:', error)

    try {
      if (outputPath && fs.existsSync(outputPath)) {
        await fsPromises.rm(outputPath, { force: true })
      }
    } catch (cleanupError) {
      log.warn('[MainWindow] Failed to remove partial export ZIP:', cleanupError)
    }

    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: message }
  } finally {
    if (tempDir) {
      try {
        await fsPromises.rm(tempDir, { recursive: true, force: true })
      } catch (cleanupError) {
        log.warn('[MainWindow] Failed to clean temp export directory:', cleanupError)
      }
    }
  }
}

/**
 * Send current status to the renderer process
 */
export function sendStatusToRenderer(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const status = buildStatus()
  mainWindow.webContents.send('main-window:statusChanged', status)
}

/**
 * Open (or focus) the main application window
 */
export function openMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    return
  }

  const appRoot = app.getAppPath()

  mainWindow = new BrowserWindow({
    width: 600,
    height: 570,
    resizable: false,
    minimizable: true,
    maximizable: false,
    title: 'MemoryLane',
    webPreferences: {
      preload: path.join(appRoot, 'out', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173/main-window.html')
  } else {
    mainWindow.loadFile(path.join(appRoot, 'out', 'renderer', 'main-window.html'))
  }

  mainWindow.on('close', (e) => {
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
}

/**
 * Get the main window instance
 */
export function getMainWindow(): BrowserWindow | null {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow
  }
  return null
}

/**
 * Build stats for the main window
 */
async function buildStats(): Promise<MainWindowStats> {
  if (!deps) {
    return {
      activityCount: 0,
      dbSize: 0,
      dateRange: { oldest: null, newest: null },
      apiUsage: null,
    }
  }

  let activityCount = 0
  let dbSize = 0
  const dateRange: { oldest: number | null; newest: number | null } = { oldest: null, newest: null }

  try {
    activityCount = deps.storage.activities.count()
    dbSize = deps.storage.getDbSize()
    const range = deps.storage.activities.getDateRange()
    dateRange.oldest = range.oldest
    dateRange.newest = range.newest
  } catch (error) {
    log.error('[MainWindow] Error fetching storage stats:', error)
  }

  const stats = deps.usageTracker.getStats()
  const apiUsage: { requestCount: number; totalCost: number } | null = {
    requestCount: stats.requestCount,
    totalCost: stats.totalCost,
  }

  return { activityCount, dbSize, dateRange, apiUsage }
}

/**
 * Initialize IPC handlers for the main window
 */
export function initMainWindowIPC(dependencies: MainWindowDependencies): void {
  deps = dependencies

  log.info('[MainWindow] Initializing IPC handlers...')

  ipcMain.handle('main-window:getStatus', () => {
    return buildStatus()
  })

  ipcMain.handle('main-window:toggleCapture', () => {
    if (!deps) {
      return { capturing: false }
    }

    if (deps.capture.isCapturingNow()) {
      void deps.capture.forceClose()
      deps.capture.stopCapture()
    } else {
      deps.capture.startCapture()
    }

    void updateTrayMenu()

    return buildStatus()
  })

  // API key management
  ipcMain.handle('main-window:getKeyStatus', () => {
    if (!deps) {
      return { hasKey: false, source: 'none', maskedKey: null }
    }
    return deps.apiKeyManager.getKeyStatus()
  })

  ipcMain.handle('main-window:saveApiKey', (_event: IpcMainInvokeEvent, key: string) => {
    if (!deps) {
      return { success: false, error: 'Dependencies not initialized' }
    }
    try {
      deps.apiKeyManager.saveApiKey(key)
      deps.semanticService.updateApiKey(key)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  ipcMain.handle('main-window:deleteApiKey', () => {
    if (!deps) {
      return { success: false, error: 'Dependencies not initialized' }
    }
    try {
      deps.apiKeyManager.deleteApiKey()
      deps.semanticService.updateApiKey(null)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Integrations
  ipcMain.handle('main-window:addToClaude', () => registerWithClaudeDesktop())
  ipcMain.handle('main-window:addToCursor', () => registerWithCursor())
  ipcMain.handle('main-window:addToClaudeCode', () => registerWithClaudeCode())

  // Custom endpoint management
  ipcMain.handle('main-window:getCustomEndpoint', () => {
    if (!deps) {
      return { enabled: false, serverURL: null, model: null, hasApiKey: false }
    }
    return deps.customEndpointManager.getStatus()
  })

  ipcMain.handle(
    'main-window:saveCustomEndpoint',
    (_event: IpcMainInvokeEvent, config: CustomEndpointConfig) => {
      if (!deps) {
        return { success: false, error: 'Dependencies not initialized' }
      }
      try {
        deps.customEndpointManager.saveEndpoint(config)
        deps.semanticService.updateEndpoint(config)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle('main-window:deleteCustomEndpoint', () => {
    if (!deps) {
      return { success: false, error: 'Dependencies not initialized' }
    }
    try {
      deps.customEndpointManager.deleteEndpoint()
      const openRouterKey = deps.apiKeyManager.getApiKey()
      deps.semanticService.updateEndpoint(null, openRouterKey)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Subscription / managed key
  deps.managedKeyService.setUpdateCallback((status, payload) => {
    if (payload?.key && deps) {
      deps.apiKeyManager.saveApiKey(payload.key, 'managed')
      deps.semanticService.updateApiKey(payload.key)
    }
    if (payload?.invalidate && deps && deps.apiKeyManager.getKeySource() === 'managed') {
      log.info('[MainWindow] Invalidating stale managed key')
      deps.apiKeyManager.deleteApiKey()
      deps.semanticService.updateApiKey(null)
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('main-window:subscriptionUpdate', {
        status,
        error: payload?.error,
      })
    }
  })

  ipcMain.handle('main-window:startCheckout', async (_event, plan: SubscriptionPlan) => {
    if (!deps) return
    await deps.managedKeyService.startCheckout(plan)
  })

  ipcMain.handle('main-window:openSubscriptionPortal', async () => {
    if (!deps) return
    await deps.managedKeyService.openSubscriptionPortal()
  })

  ipcMain.handle('main-window:getSubscriptionStatus', () => {
    if (!deps) return 'idle'
    return deps.managedKeyService.getStatus()
  })

  // Stats
  ipcMain.handle('main-window:getStats', () => buildStats())

  // Database export
  ipcMain.handle('main-window:exportDatabaseZip', async () => {
    return exportDatabaseZip()
  })

  // Capture settings
  ipcMain.handle('main-window:getCaptureSettings', () => {
    if (!deps) return null
    return deps.captureSettingsManager.get()
  })

  ipcMain.handle(
    'main-window:saveCaptureSettings',
    (_event: IpcMainInvokeEvent, partial: Partial<CaptureSettings>) => {
      if (!deps) return { success: false, error: 'Dependencies not initialized' }
      try {
        deps.captureSettingsManager.save(partial)
        deps.captureSettingsManager.applyToConstants()
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle('main-window:resetCaptureSettings', () => {
    if (!deps) return { success: false, error: 'Dependencies not initialized' }
    try {
      deps.captureSettingsManager.reset()
      deps.captureSettingsManager.applyToConstants()
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })
}
