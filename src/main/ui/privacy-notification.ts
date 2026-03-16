import { app, BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import log from '../logger'

const POPUP_WIDTH = 252
const POPUP_HEIGHT = 60
const POPUP_MARGIN = 32
const POPUP_DURATION_MS = 3000

type PrivacyNotificationState = 'entering' | 'exiting'

let privacyNotificationWindow: BrowserWindow | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let notificationGeneration = 0

const clearHideTimer = (): void => {
  if (!hideTimer) return
  clearTimeout(hideTimer)
  hideTimer = null
}

const closePrivacyNotification = (): void => {
  clearHideTimer()
  if (!privacyNotificationWindow || privacyNotificationWindow.isDestroyed()) {
    privacyNotificationWindow = null
    return
  }
  privacyNotificationWindow.close()
}

const buildNotificationUrl = (state: PrivacyNotificationState): string => {
  if (!app.isPackaged) {
    return `http://localhost:5173/privacy-notification.html?state=${state}`
  }

  const notificationPath = path.join(
    app.getAppPath(),
    'out',
    'renderer',
    'privacy-notification.html',
  )
  const fileUrl = pathToFileURL(notificationPath)
  fileUrl.searchParams.set('state', state)
  return fileUrl.toString()
}

export const showPrivacyModeNotification = (blocked: boolean): void => {
  if (!app.isReady()) {
    log.info('[PrivacyNotification] App is not ready; skipping popup')
    return
  }

  try {
    notificationGeneration += 1
    const generation = notificationGeneration
    closePrivacyNotification()

    const state: PrivacyNotificationState = blocked ? 'entering' : 'exiting'
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const { x, y, width } = display.workArea
    const popupX = Math.round(x + width - POPUP_WIDTH - POPUP_MARGIN)
    const popupY = Math.round(y + POPUP_MARGIN)

    const nextWindow = new BrowserWindow({
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      x: popupX,
      y: popupY,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: true,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      fullscreenable: false,
      hasShadow: false,
      useContentSize: true,
      backgroundColor: '#00000000',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    privacyNotificationWindow = nextWindow

    nextWindow.setAlwaysOnTop(true, 'screen-saver')
    nextWindow.once('closed', () => {
      if (privacyNotificationWindow === nextWindow) {
        privacyNotificationWindow = null
      }
      if (generation === notificationGeneration) {
        clearHideTimer()
      }
    })

    void nextWindow.loadURL(buildNotificationUrl(state))

    nextWindow.once('ready-to-show', () => {
      if (generation !== notificationGeneration) {
        nextWindow.close()
        return
      }
      if (privacyNotificationWindow !== nextWindow || nextWindow.isDestroyed()) return
      nextWindow.showInactive()
    })

    hideTimer = setTimeout(() => {
      if (generation !== notificationGeneration) return
      closePrivacyNotification()
    }, POPUP_DURATION_MS)
    hideTimer.unref?.()
  } catch (error) {
    log.error('[PrivacyNotification] Failed to show popup:', error)
  }
}

app.on('before-quit', () => {
  closePrivacyNotification()
})
