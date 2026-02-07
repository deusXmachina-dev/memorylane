import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { ApiKeyManager } from './api-key-manager'
import { CaptureSettingsManager } from './capture-settings-manager'
import { SemanticClassifierService } from '../processor/semantic-classifier'
import { registerWithClaudeDesktop } from '../integrations/claude-desktop'
import { registerWithCursor } from '../integrations/cursor'
import { CaptureSettings } from '../../shared/types'
import log from '../logger'

let settingsWindow: BrowserWindow | null = null

/**
 * Open (or focus) the settings window
 */
export function openSettingsWindow(): void {
  // If window already exists, focus it
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 600,
    height: 650,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Settings',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Load the settings page
  // In dev mode, load from dev server; in production, load from file
  if (process.env.NODE_ENV === 'development') {
    settingsWindow.loadURL('http://localhost:5173/settings.html')
  } else {
    settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'))
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
}

let classifierService: SemanticClassifierService | null = null

/**
 * Initialize IPC handlers for settings
 */
export function initSettingsIPC(
  apiKeyManager: ApiKeyManager,
  classifier?: SemanticClassifierService,
): void {
  log.info('[SettingsIPC] Initializing IPC handlers...')
  classifierService = classifier || null

  // Get current key status
  ipcMain.handle('settings:getKeyStatus', () => {
    log.info('[SettingsIPC] settings:getKeyStatus handler called')
    const status = apiKeyManager.getKeyStatus()
    log.info('[SettingsIPC] Returning status:', status)
    return status
  })

  // Save API key
  ipcMain.handle('settings:saveApiKey', (_event: IpcMainInvokeEvent, key: string) => {
    try {
      apiKeyManager.saveApiKey(key)
      // Update the classifier with the new API key
      if (classifierService) {
        classifierService.updateApiKey(key)
      }
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Delete API key
  ipcMain.handle('settings:deleteApiKey', () => {
    try {
      apiKeyManager.deleteApiKey()
      // Clear the API key from the classifier
      if (classifierService) {
        classifierService.updateApiKey(null)
      }
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Close settings window
  ipcMain.on('settings:close', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.close()
    }
  })

  // Integration handlers
  ipcMain.handle('settings:addToClaude', () => registerWithClaudeDesktop())
  ipcMain.handle('settings:addToCursor', () => registerWithCursor())
}

/**
 * Initialize IPC handlers for capture settings
 */
export function initCaptureSettingsIPC(captureSettingsManager: CaptureSettingsManager): void {
  log.info('[SettingsIPC] Initializing capture settings IPC handlers...')

  // Get current capture settings
  ipcMain.handle('capture-settings:get', () => {
    log.info('[SettingsIPC] capture-settings:get handler called')
    const settings = captureSettingsManager.getSettings()
    const defaults = captureSettingsManager.getDefaultSettings()
    log.info('[SettingsIPC] Returning capture settings:', settings)
    return { settings, defaults }
  })

  // Save capture settings (partial update)
  ipcMain.handle(
    'capture-settings:save',
    (_event: IpcMainInvokeEvent, partialSettings: Partial<CaptureSettings>) => {
      try {
        captureSettingsManager.saveSettings(partialSettings)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    },
  )

  // Reset capture settings to defaults
  ipcMain.handle('capture-settings:reset', () => {
    try {
      captureSettingsManager.resetToDefaults()
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })
}
