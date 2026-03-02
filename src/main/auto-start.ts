import { app } from 'electron'
import log from './logger'

const AUTO_START_HIDDEN_ARG = '--memorylane-hidden'
const WINDOWS_LOGIN_ITEM_ARGS = [AUTO_START_HIDDEN_ARG]

function isSupportedPlatform(): boolean {
  return process.platform === 'darwin' || process.platform === 'win32'
}

export function canSyncAutoStartSetting(): boolean {
  return isSupportedPlatform() && app.isPackaged
}

export function shouldStartHiddenOnLaunch(): boolean {
  if (process.argv.includes(AUTO_START_HIDDEN_ARG)) {
    return true
  }

  if (process.platform !== 'darwin') {
    return false
  }

  return app.getLoginItemSettings({ type: 'mainAppService' }).wasOpenedAtLogin
}

export function syncAutoStartSetting(enabled: boolean): void {
  if (!isSupportedPlatform()) {
    log.info('[AutoStart] Login-item registration is not supported on this platform')
    return
  }

  if (!app.isPackaged) {
    log.info('[AutoStart] Skipping login-item registration in development')
    return
  }

  if (process.platform === 'darwin') {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      type: 'mainAppService',
    })

    const loginItemSettings = app.getLoginItemSettings({ type: 'mainAppService' })
    log.info(
      `[AutoStart] macOS login item synced (enabled=${enabled}, status=${loginItemSettings.status})`,
    )
    return
  }

  app.setLoginItemSettings({
    openAtLogin: enabled,
    enabled,
    path: process.execPath,
    args: WINDOWS_LOGIN_ITEM_ARGS,
  })

  const loginItemSettings = app.getLoginItemSettings({
    path: process.execPath,
    args: WINDOWS_LOGIN_ITEM_ARGS,
  })
  log.info(
    '[AutoStart] Windows login item synced',
    JSON.stringify({
      enabled,
      openAtLogin: loginItemSettings.openAtLogin,
      executableWillLaunchAtLogin: loginItemSettings.executableWillLaunchAtLogin,
    }),
  )
}
