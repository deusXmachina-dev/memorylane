import { existsSync } from 'node:fs'
import { app } from 'electron'
import { loadAppEditionConfig } from '@main/system/edition'

// The pkg-installed LaunchAgent (assets/pkg-scripts/postinstall) supervises
// the app with unconditional KeepAlive: launchd relaunches it after any exit,
// SIGTERM from RMM/AV scripts included. Enterprise is always-running — there
// is no user-level quit; capture on/off is the user control. The plist passes
// LAUNCHD_MANAGED_ARG so an instance can tell launchd is supervising it.
export const LAUNCHD_MANAGED_ARG = '--memorylane-launchd'
const LABEL = 'com.memorylane.enterprise.launcher'
const PLIST_PATH = `/Library/LaunchAgents/${LABEL}.plist`

export function isLaunchdManaged(): boolean {
  return (
    process.platform === 'darwin' &&
    app.isPackaged &&
    loadAppEditionConfig().edition === 'enterprise' &&
    process.argv.includes(LAUNCHD_MANAGED_ARG) &&
    existsSync(PLIST_PATH)
  )
}
