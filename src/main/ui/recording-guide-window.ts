/**
 * Small always-on-top window that shows a scripted eval recording's steps while
 * the operator performs them. It never takes focus (so the take stays in the
 * operator's own apps) and is left out of captured frames: by title in the macOS
 * capture filter, by content protection on Windows.
 */

import { app, BrowserWindow, screen } from 'electron'
import path from 'node:path'

const TITLE = 'MemoryLane recording guide'
const WIDTH = 340
const MARGIN = 16

let guide: BrowserWindow | null = null

export async function showRecordingGuide(): Promise<void> {
  if (guide && !guide.isDestroyed()) return
  const appRoot = app.getAppPath()
  const { workArea } = screen.getPrimaryDisplay()

  const win = new BrowserWindow({
    width: WIDTH,
    height: 240,
    x: workArea.x + workArea.width - WIDTH - MARGIN,
    y: workArea.y + MARGIN,
    title: TITLE,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    acceptFirstMouse: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(appRoot, 'out', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  guide = win
  win.on('page-title-updated', (event) => event.preventDefault())
  win.on('closed', () => {
    if (guide === win) guide = null
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setContentProtection(true)

  if (!app.isPackaged) await win.loadURL('http://localhost:5173/recording-guide.html')
  else await win.loadFile(path.join(appRoot, 'out', 'renderer', 'recording-guide.html'))
  win.showInactive()
}

export function resizeRecordingGuide(height: number): void {
  if (!guide || guide.isDestroyed()) return
  guide.setContentSize(WIDTH, Math.min(600, Math.max(120, Math.round(height))))
}

export function closeRecordingGuide(): void {
  if (guide && !guide.isDestroyed()) guide.destroy()
  guide = null
}
