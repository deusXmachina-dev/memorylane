/**
 * Main application window for MemoryLane
 *
 * Provides a visible control surface alongside the system tray.
 * Singleton window that hides on close instead of destroying.
 */

import { BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import log from '../logger'
import { openSettingsWindow } from '../settings/settings-window'
import { updateTrayMenu } from './tray'
import type { EventProcessor } from '../processor/index'

interface MainWindowDependencies {
  recorder: {
    isCapturingNow: () => boolean
    startCapture: () => void
    stopCapture: () => void
  }
  interactionMonitor: {
    stopInteractionMonitoring: () => void
  }
  processor: EventProcessor
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

  mainWindow = new BrowserWindow({
    width: 600,
    height: 320,
    resizable: false,
    minimizable: true,
    maximizable: false,
    title: 'MemoryLane',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173/main-window.html')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/main-window.html'))
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
      deps.recorder.stopCapture()
      deps.interactionMonitor.stopInteractionMonitoring()
    } else {
      deps.recorder.startCapture()
    }

    void updateTrayMenu()

    return buildStatus()
  })

  ipcMain.on('main-window:openSettings', () => {
    openSettingsWindow()
  })
}
