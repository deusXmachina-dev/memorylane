/**
 * System tray management for MemoryLane
 */

import { app, Tray, Menu, nativeImage, dialog } from 'electron'
import path from 'node:path'
import * as fs from 'fs'
import log from '../logger'
import { captureWindow } from '../recorder/window-capture'
import { formatBytes, formatNumber } from '../utils/formatters'
import { registerWithClaudeDesktop } from '../integrations/claude-desktop'
import { registerWithCursor } from '../integrations/cursor'
import { registerWithClaudeCode } from '../integrations/claude-code'
import type { EventProcessor } from '../processor/index'
import { sendStatusToRenderer, openMainWindow } from './main-window'

interface TrayDependencies {
  recorder: {
    isCapturingNow: () => boolean
    startCapture: () => void
    stopCapture: () => void
    getScreenshotsDir: () => string
  }
  interactionMonitor: {
    stopInteractionMonitoring: () => void
  }
  processor: EventProcessor
}

let tray: Tray | null = null
let deps: TrayDependencies | null = null
const isDev = !app.isPackaged

app.on('before-quit', () => {
  if (tray) {
    tray.destroy()
    tray = null
  }

  // Safety net: force-exit if graceful shutdown takes too long.
  // In-flight async work (OCR subprocesses, embedding inference, API calls)
  // can keep the event loop alive indefinitely after app.quit().
  setTimeout(() => {
    log.warn('[Quit] Graceful shutdown timed out — force exiting')
    app.exit(0)
  }, 3000).unref()
})

/**
 * Build the usage stats submenu with API and storage statistics
 */
const buildUsageStatsSubmenu = async (): Promise<Electron.MenuItemConstructorOptions[]> => {
  const submenu: Electron.MenuItemConstructorOptions[] = []

  if (!deps?.processor) {
    submenu.push({
      label: 'Stats not available',
      enabled: false,
    })
    return submenu
  }

  const classifier = deps.processor.getClassifierService()
  const storage = deps.processor.getStorageService()

  if (classifier) {
    const usageTracker = classifier.getUsageTracker()
    const stats = usageTracker.getStats()

    submenu.push(
      {
        label: `API Requests: ${formatNumber(stats.requestCount)}`,
        enabled: false,
      },
      {
        label: `Tokens: ${formatNumber(stats.promptTokens)} (prompt) / ${formatNumber(stats.completionTokens)} (completion)`,
        enabled: false,
      },
      {
        label: `Est. Cost: $${stats.totalCost.toFixed(4)}`,
        enabled: false,
      },
    )
  } else {
    submenu.push({
      label: 'API tracking unavailable (no API key)',
      enabled: false,
    })
  }

  submenu.push({ type: 'separator' })

  try {
    const screenshotCount = await storage.countRows()
    const dbSize = storage.getDbSize()

    submenu.push(
      {
        label: `Screenshots: ${formatNumber(screenshotCount)}`,
        enabled: false,
      },
      {
        label: `Database: ${formatBytes(dbSize)}`,
        enabled: false,
      },
    )
  } catch (error) {
    log.error('Error fetching storage stats:', error)
    submenu.push({
      label: 'Storage stats unavailable',
      enabled: false,
    })
  }

  return submenu
}

/**
 * Update the tray context menu with current state
 */
export const updateTrayMenu = async (): Promise<void> => {
  if (!tray || !deps) return

  const isCapturing = deps.recorder.isCapturingNow()

  const usageStatsSubmenu = await buildUsageStatsSubmenu()

  const contextMenu = Menu.buildFromTemplate([
    {
      label: isCapturing ? 'Stop Capture' : 'Start Capture',
      click: () => {
        if (isCapturing) {
          deps!.recorder.stopCapture()
          deps!.interactionMonitor.stopInteractionMonitoring()
        } else {
          deps!.recorder.startCapture()
        }
        void updateTrayMenu()
        void sendStatusToRenderer()
      },
    },
    { type: 'separator' },
    {
      label: 'Usage Stats',
      submenu: usageStatsSubmenu,
    },
    {
      label: 'Open MemoryLane',
      click: () => {
        openMainWindow()
      },
    },
    { type: 'separator' },
    {
      label: 'Add to Claude Desktop',
      click: () => {
        void registerWithClaudeDesktop()
      },
    },
    {
      label: 'Add to Cursor',
      click: () => {
        void registerWithCursor()
      },
    },
    {
      label: 'Add to Claude Code',
      click: () => {
        void registerWithClaudeCode()
      },
    },
    ...(isDev
      ? [
          { type: 'separator' as const },
          {
            label: 'Test Window Capture',
            click: async () => {
              const result = await captureWindow()
              if (!result) {
                dialog.showErrorBox('Window Capture', 'No window captured (null result)')
                return
              }
              const outPath = path.join(app.getPath('temp'), `memorylane-test-${Date.now()}.png`)
              fs.writeFileSync(outPath, result.image)
              log.info(
                `[TestCapture] "${result.title}" ${result.width}x${result.height} → ${outPath}`,
              )
              dialog.showMessageBox({
                type: 'info',
                title: 'Window Capture',
                message: `Captured "${result.title}" (${result.width}x${result.height})`,
                detail: `Saved to ${outPath}`,
              })
            },
          },
        ]
      : []),
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        deps!.recorder.stopCapture()
        deps!.interactionMonitor.stopInteractionMonitoring()
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)
}

/**
 * Setup the system tray with icon, tooltip, and menu
 */
export const setupTray = (dependencies: TrayDependencies): void => {
  deps = dependencies

  const iconPath = isDev
    ? path.join(app.getAppPath(), 'assets', 'tray-icon.png')
    : path.join(process.resourcesPath, 'assets', 'tray-icon.png')
  let icon: Electron.NativeImage

  try {
    icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) {
      icon = nativeImage.createEmpty()
    }
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip('MemoryLane - Screen Capture')

  void updateTrayMenu()
}
