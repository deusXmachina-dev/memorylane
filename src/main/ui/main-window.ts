/**
 * Main application window for MemoryLane
 *
 * Provides a visible control surface alongside the system tray.
 * Singleton window that hides on close instead of destroying.
 */

import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import log from '../logger'
import { updateTrayMenu } from './tray'
import { registerWithClaudeDesktop } from '../integrations/claude-desktop'
import { registerWithCursor } from '../integrations/cursor'
import { registerWithClaudeCode } from '../integrations/claude-code'
import type { ActivityProcessor } from '../processor/index'
import type { ApiKeyManager } from '../settings/api-key-manager'
import type { CustomEndpointManager } from '../settings/custom-endpoint-manager'
import type { SemanticClassifierService } from '../processor/semantic-classifier'
import type { ManagedKeyService } from '../services/managed-key-service'
import type { ActivityManager } from '../processor/activity-manager'
import type { CustomEndpointConfig, MainWindowStats, CaptureSettings } from '../../shared/types'
import type { CaptureSettingsManager } from '../settings/capture-settings-manager'

interface MainWindowDependencies {
  recorder: {
    isCapturingNow: () => boolean
    startCapture: () => void
    stopCapture: () => void
  }
  activityManager: ActivityManager
  processor: ActivityProcessor
  apiKeyManager: ApiKeyManager
  customEndpointManager: CustomEndpointManager
  classifierService: SemanticClassifierService
  managedKeyService: ManagedKeyService
  captureSettingsManager: CaptureSettingsManager
}

interface MainWindowStatus {
  capturing: boolean
}

let mainWindow: BrowserWindow | null = null
let deps: MainWindowDependencies | null = null

function buildStatus(): MainWindowStatus {
  return {
    capturing: deps?.recorder.isCapturingNow() ?? false,
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
    if (mainWindow && !mainWindow.isDestroyed()) {
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

  const storage = deps.processor.getStorageService()
  const classifier = deps.processor.getClassifierService()

  let activityCount = 0
  let dbSize = 0
  const dateRange: { oldest: number | null; newest: number | null } = { oldest: null, newest: null }

  try {
    activityCount = await storage.countRows()
    dbSize = storage.getDbSize()
    const range = await storage.getDateRange()
    dateRange.oldest = range.oldest
    dateRange.newest = range.newest
  } catch (error) {
    log.error('[MainWindow] Error fetching storage stats:', error)
  }

  let apiUsage: { requestCount: number; totalCost: number } | null = null
  if (classifier) {
    const usageTracker = classifier.getUsageTracker()
    const stats = usageTracker.getStats()
    apiUsage = {
      requestCount: stats.requestCount,
      totalCost: stats.totalCost,
    }
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

    if (deps.recorder.isCapturingNow()) {
      void deps.activityManager.forceClose()
      deps.recorder.stopCapture()
    } else {
      deps.recorder.startCapture()
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
      deps.classifierService.updateApiKey(key)
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
      deps.classifierService.updateApiKey(null)
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
        deps.classifierService.updateEndpoint(config)
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
      deps.classifierService.updateEndpoint(null, openRouterKey)
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
      deps.classifierService.updateApiKey(payload.key)
    }
    if (payload?.invalidate && deps && deps.apiKeyManager.getKeySource() === 'managed') {
      log.info('[MainWindow] Invalidating stale managed key')
      deps.apiKeyManager.deleteApiKey()
      deps.classifierService.updateApiKey(null)
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('main-window:subscriptionUpdate', {
        status,
        error: payload?.error,
      })
    }
  })

  ipcMain.handle('main-window:startCheckout', async () => {
    if (!deps) return
    await deps.managedKeyService.startCheckout()
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
