/**
 * System tray management for MemoryLane
 */

import { app, Tray, Menu, nativeImage } from 'electron'
import path from 'node:path'
import log from '../logger'
import { formatBytes, formatNumber } from '../utils/formatters'
import { openSettingsWindow } from '../settings/settings-window'
import { registerWithClaudeDesktop } from '../integrations/claude-desktop'
import { registerWithCursor } from '../integrations/cursor'
import { Screenshot, InteractionContext } from '../../shared/types'
import type { EventProcessor } from '../processor/index'
import { sendStatusToRenderer } from './main-window'

interface TrayDependencies {
  recorder: {
    isCapturingNow: () => boolean
    startCapture: () => void
    stopCapture: () => void
    getScreenshotsDir: () => string
    onScreenshot: (callback: (screenshot: Screenshot) => void) => void
  }
  interactionMonitor: {
    stopInteractionMonitoring: () => void
    onInteraction: (callback: (event: InteractionContext) => void) => void
  }
  processor: EventProcessor
}

let tray: Tray | null = null
let deps: TrayDependencies | null = null

app.on('before-quit', () => {
  if (tray) {
    tray.destroy()
    tray = null
  }
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
      label: 'Settings...',
      click: () => {
        openSettingsWindow()
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
 * Registers callbacks for screenshot and interaction events
 */
export const setupTray = (dependencies: TrayDependencies): void => {
  deps = dependencies

  // Try to load custom icon, fall back to default
  // In dev: __dirname is out/main, assets is at ../../assets
  // In production: assets are in resources/assets
  const isDev = !app.isPackaged
  const iconPath = isDev
    ? path.join(__dirname, '../../assets/tray-icon.png')
    : path.join(process.resourcesPath, 'assets/tray-icon.png')
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

  // Register a callback to process screenshots
  deps.recorder.onScreenshot(async (screenshot: Screenshot) => {
    log.info(`[Main] Screenshot captured: ${screenshot.id}`)

    if (deps?.processor) {
      try {
        await deps.processor.processScreenshot(screenshot)
        log.info(`[Main] Screenshot processed successfully: ${screenshot.id}`)
        void updateTrayMenu()
        void sendStatusToRenderer()
      } catch (error) {
        log.error(`[Main] Error processing screenshot ${screenshot.id}:`, error)
      }
    }
  })

  // Subscribe to interaction events - pass them to the processor for aggregation
  deps.interactionMonitor.onInteraction((event) => {
    if (deps?.processor) {
      deps.processor.addInteractionEvent(event)
    }
  })
}
