import { app } from 'electron'
import { loadAppEditionConfig } from '@main/system/edition'
import log from '@main/utils/logger'

export const AUTO_START_HIDDEN_ARG = '--memorylane-hidden'
const WINDOWS_LOGIN_ITEM_ARGS = [AUTO_START_HIDDEN_ARG]

function isSupportedPlatform(): boolean {
  return process.platform === 'darwin' || process.platform === 'win32'
}

// Enterprise autostart on macOS is owned by the pkg-installed LaunchAgent. A
// login item would race it at login (mac login items can't pass argv, so the
// losing instance pops the main window) and, when it wins the race, steal the
// app from launchd's KeepAlive supervision.
function launchAgentOwnsAutoStart(): boolean {
  return process.platform === 'darwin' && loadAppEditionConfig().edition === 'enterprise'
}

// Mac enterprise re-syncs every startup, not just once: installs upgraded from
// pre-LaunchAgent builds carry a stale login item that sync removes.
export function shouldSyncAutoStartOnStartup(isInitialized: boolean): boolean {
  if (!isSupportedPlatform() || !app.isPackaged) return false
  return !isInitialized || launchAgentOwnsAutoStart()
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
    // Also removes the item registered by older enterprise builds.
    if (launchAgentOwnsAutoStart()) {
      app.setLoginItemSettings({ openAtLogin: false, type: 'mainAppService' })
      log.info('[AutoStart] macOS enterprise: autostart is owned by the LaunchAgent')
      return
    }

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
