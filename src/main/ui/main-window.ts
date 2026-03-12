/**
 * Main application window for MemoryLane
 *
 * Provides a visible control surface alongside the system tray.
 * Singleton window that hides on close instead of destroying.
 */

import { app, BrowserWindow, dialog, ipcMain, IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { syncAutoStartSetting } from '../auto-start'
import log from '../logger'
import { updateTrayMenu } from './tray'
import { exportDatabaseZip } from './database-export'
import { registerWithClaudeDesktop } from '../integrations/claude-desktop'
import { registerWithCursor } from '../integrations/cursor'
import { registerWithClaudeCode } from '../integrations/claude-code'
import { SlackSettingsManager } from '../integrations/slack/settings-manager'
import { SlackIntegrationService } from '../integrations/slack/service'
import type { ApiKeyManager } from '../settings/api-key-manager'
import type { CustomEndpointManager } from '../settings/custom-endpoint-manager'
import type { ManagedKeyService } from '../services/managed-key-service'
import type {
  CustomEndpointConfig,
  LlmHealthStatus,
  MainWindowStatus,
  MainWindowStats,
  CaptureSettings,
  SemanticPipelineMode,
  SlackIntegrationConfig,
  SubscriptionPlan,
} from '../../shared/types'
import type { CaptureSettingsManager } from '../settings/capture-settings-manager'
import type { StorageService } from '../storage'
import type { UsageTracker } from '../services/usage-tracker'

interface SemanticService {
  updateApiKey(apiKey: string | null): void
  updateEndpoint(config: CustomEndpointConfig | null, openRouterKey?: string | null): void
  updatePipelinePreference(preference: SemanticPipelineMode): void
  updateRequestTimeoutMs(timeoutMs: number): void
  getLlmHealthStatus(): LlmHealthStatus
  testConnection(): Promise<void>
}

interface MainWindowDependencies {
  capture: {
    isCapturingNow: () => boolean
    requestStartCapture: () => void
    requestStopCapture: () => void
    forceClose: () => Promise<void>
    updateActivityWindowConfig: (input: {
      minActivityDurationMs: number
      maxActivityDurationMs: number
    }) => void
  }
  storage: StorageService
  usageTracker: UsageTracker
  apiKeyManager: ApiKeyManager
  customEndpointManager: CustomEndpointManager
  semanticService: SemanticService
  managedKeyService: ManagedKeyService
  captureSettingsManager: CaptureSettingsManager
  slackSettingsManager: SlackSettingsManager
  slackIntegrationService: SlackIntegrationService
  getCaptureHotkeyLabel: () => string
  reconfigureCaptureHotkey: (accelerator: string) => { success: boolean; error?: string }
  updateExclusions: (exclusions: {
    apps: string[]
    windowTitlePatterns: string[]
    urlPatterns: string[]
    excludePrivateBrowsing: boolean
  }) => void
  databaseExportSync: {
    onSettingsChanged: () => Promise<void>
  }
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
    captureHotkeyLabel: deps?.getCaptureHotkeyLabel() ?? '',
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
    width: 800,
    height: 720,
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

  if (!app.isPackaged) {
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
      return {
        capturing: false,
        captureHotkeyLabel: '',
      }
    }

    if (deps.capture.isCapturingNow()) {
      deps.capture.requestStopCapture()
    } else {
      deps.capture.requestStartCapture()
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
      void deps.semanticService.testConnection()
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

  ipcMain.handle('main-window:getLlmHealth', () => {
    if (!deps) {
      return {
        configured: false,
        state: 'not_configured',
        consecutiveFailures: 0,
        lastError: null,
        lastAttemptAt: null,
      }
    }
    return deps.semanticService.getLlmHealthStatus()
  })

  ipcMain.handle('main-window:testLlmConnection', async () => {
    if (!deps) return
    await deps.semanticService.testConnection()
  })

  ipcMain.handle(
    'main-window:saveCustomEndpoint',
    (_event: IpcMainInvokeEvent, config: CustomEndpointConfig) => {
      if (!deps) {
        return { success: false, error: 'Dependencies not initialized' }
      }
      try {
        deps.customEndpointManager.saveEndpoint(config)
        deps.semanticService.updateEndpoint(deps.customEndpointManager.getEndpoint())
        void deps.semanticService.testConnection()
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

  ipcMain.handle('main-window:getSlackSettings', () => {
    if (!deps) {
      return {
        enabled: false,
        running: false,
        hasBotToken: false,
        maskedBotToken: null,
        ownerUserId: '',
        watchedChannelIds: '',
        pollIntervalMs: 60000,
        allwaysApprove: true,
        lastError: null,
      }
    }

    return deps.slackSettingsManager.getStatus(deps.slackIntegrationService.getRuntimeState())
  })

  ipcMain.handle(
    'main-window:saveSlackSettings',
    async (_event: IpcMainInvokeEvent, config: SlackIntegrationConfig) => {
      if (!deps) {
        return { success: false, error: 'Dependencies not initialized' }
      }
      try {
        deps.slackSettingsManager.save(config)
        await deps.slackIntegrationService.reload()
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle('main-window:resetSlackSettings', async () => {
    if (!deps) {
      return { success: false, error: 'Dependencies not initialized' }
    }
    try {
      deps.slackSettingsManager.reset()
      await deps.slackIntegrationService.reload()
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

  // Patterns
  ipcMain.handle('main-window:getPatterns', () => {
    if (!deps) return []
    return deps.storage.patterns.getAllPatterns()
  })

  ipcMain.handle('main-window:rejectPattern', (_event: IpcMainInvokeEvent, id: string) => {
    if (!deps) return { success: false, error: 'Dependencies not initialized' }
    try {
      deps.storage.patterns.rejectPattern(id)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    'main-window:markPatternPromptCopied',
    (_event: IpcMainInvokeEvent, id: string) => {
      if (!deps) return { success: false, error: 'Dependencies not initialized' }
      try {
        deps.storage.patterns.markPromptCopied(id)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    },
  )

  // Stats
  ipcMain.handle('main-window:getStats', () => buildStats())

  ipcMain.handle(
    'main-window:chooseDatabaseExportDirectory',
    async (_event: IpcMainInvokeEvent, initialPath?: string) => {
      try {
        const result = await dialog.showOpenDialog(getMainWindow() ?? undefined, {
          properties: ['openDirectory', 'createDirectory'],
          defaultPath:
            typeof initialPath === 'string' && /\S/.test(initialPath) ? initialPath : undefined,
        })

        if (result.canceled) {
          return { cancelled: true }
        }

        return {
          cancelled: false,
          directoryPath: result.filePaths[0],
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to choose folder'
        return { cancelled: false, error: message }
      }
    },
  )

  // Database export
  ipcMain.handle('main-window:exportDatabaseZip', async () => {
    if (!deps) {
      return { success: false, error: 'Dependencies not initialized' }
    }
    return exportDatabaseZip({ storage: deps.storage, parentWindow: getMainWindow() })
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
      const previous = deps.captureSettingsManager.get()
      try {
        if (
          partial.captureHotkeyAccelerator !== undefined &&
          partial.captureHotkeyAccelerator !== previous.captureHotkeyAccelerator
        ) {
          const hotkeyResult = deps.reconfigureCaptureHotkey(partial.captureHotkeyAccelerator)
          if (!hotkeyResult.success) {
            return {
              success: false,
              error: hotkeyResult.error ?? 'Failed to update start/stop shortcut',
            }
          }
        }

        deps.captureSettingsManager.save(partial)
        deps.captureSettingsManager.applyToConstants()
        const updated = deps.captureSettingsManager.get()
        syncAutoStartSetting(updated.autoStartEnabled)
        deps.capture.updateActivityWindowConfig({
          minActivityDurationMs: updated.minActivityDurationMs,
          maxActivityDurationMs: updated.maxActivityDurationMs,
        })
        deps.updateExclusions({
          apps: updated.excludedApps,
          windowTitlePatterns: updated.excludedWindowTitlePatterns,
          urlPatterns: updated.excludedUrlPatterns,
          excludePrivateBrowsing: updated.excludePrivateBrowsing,
        })
        deps.semanticService.updatePipelinePreference(updated.semanticPipelineMode)
        deps.semanticService.updateRequestTimeoutMs(updated.semanticRequestTimeoutMs)
        void updateTrayMenu()
        sendStatusToRenderer()
        void deps.databaseExportSync.onSettingsChanged()
        return { success: true }
      } catch (error) {
        if (
          partial.captureHotkeyAccelerator !== undefined &&
          partial.captureHotkeyAccelerator !== previous.captureHotkeyAccelerator
        ) {
          deps.reconfigureCaptureHotkey(previous.captureHotkeyAccelerator)
        }
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle('main-window:resetCaptureSettings', () => {
    if (!deps) return { success: false, error: 'Dependencies not initialized' }
    const previous = deps.captureSettingsManager.get()
    try {
      deps.captureSettingsManager.reset()
      deps.captureSettingsManager.applyToConstants()
      const updated = deps.captureSettingsManager.get()
      const hotkeyResult = deps.reconfigureCaptureHotkey(updated.captureHotkeyAccelerator)
      if (!hotkeyResult.success) {
        deps.captureSettingsManager.save(previous)
        deps.captureSettingsManager.applyToConstants()
        return {
          success: false,
          error: hotkeyResult.error ?? 'Failed to reset start/stop shortcut',
        }
      }
      syncAutoStartSetting(updated.autoStartEnabled)
      deps.capture.updateActivityWindowConfig({
        minActivityDurationMs: updated.minActivityDurationMs,
        maxActivityDurationMs: updated.maxActivityDurationMs,
      })
      deps.updateExclusions({
        apps: updated.excludedApps,
        windowTitlePatterns: updated.excludedWindowTitlePatterns,
        urlPatterns: updated.excludedUrlPatterns,
        excludePrivateBrowsing: updated.excludePrivateBrowsing,
      })
      deps.semanticService.updatePipelinePreference(updated.semanticPipelineMode)
      deps.semanticService.updateRequestTimeoutMs(updated.semanticRequestTimeoutMs)
      void updateTrayMenu()
      sendStatusToRenderer()
      void deps.databaseExportSync.onSettingsChanged()
      return { success: true }
    } catch (error) {
      deps.reconfigureCaptureHotkey(previous.captureHotkeyAccelerator)
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })
}
