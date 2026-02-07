/**
 * Main application window for MemoryLane
 *
 * Provides a visible control surface alongside the system tray.
 * Singleton window that hides on close instead of destroying.
 */

import { app, BrowserWindow, ipcMain } from 'electron'
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
  screenshotCount: number
}

let mainWindow: BrowserWindow | null = null
let deps: MainWindowDependencies | null = null

async function buildStatus(): Promise<MainWindowStatus> {
  let screenshotCount = 0
  if (deps?.processor) {
    try {
      screenshotCount = await deps.processor.getStorageService().countRows()
    } catch {
      // Storage unavailable
    }
  }

  return {
    capturing: deps?.recorder.isCapturingNow() ?? false,
    screenshotCount,
  }
}

/**
 * Send current status to the renderer process
 */
export async function sendStatusToRenderer(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const status = await buildStatus()
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
    width: 400,
    height: 300,
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
      if (process.platform === 'darwin') {
        app.dock?.hide()
      }
    }
  })

  mainWindow.on('show', () => {
    if (process.platform === 'darwin') {
      app.dock?.show()
    }
  })

  if (process.platform === 'darwin') {
    app.dock?.show()
  }
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

  ipcMain.handle('main-window:getStatus', async () => {
    return buildStatus()
  })

  ipcMain.handle('main-window:toggleCapture', async () => {
    if (!deps) {
      return { capturing: false, screenshotCount: 0 }
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
