import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { app } from 'electron'
import { loadAppEditionConfig } from '@main/system/edition'
import log from '@main/utils/logger'

const execFileAsync = promisify(execFile)

// The pkg-installed LaunchAgent (assets/pkg-scripts/postinstall) supervises
// the app with unconditional KeepAlive: launchd relaunches it after any exit —
// SIGTERM from RMM/AV scripts included. The only exit that holds is an
// explicit tray Quit, which boots the job out first; RunAtLoad re-arms it at
// the next login. The plist passes LAUNCHD_MANAGED_ARG so an instance can
// tell whether launchd is supervising it.
export const LAUNCHD_MANAGED_ARG = '--memorylane-launchd'
const LABEL = 'com.memorylane.enterprise.launcher'
const PLIST_PATH = `/Library/LaunchAgents/${LABEL}.plist`
const LAUNCHCTL_TIMEOUT_MS = 5_000

function launchdSupported(): boolean {
  return (
    process.platform === 'darwin' &&
    app.isPackaged &&
    loadAppEditionConfig().edition === 'enterprise' &&
    existsSync(PLIST_PATH)
  )
}

export function isLaunchdManaged(): boolean {
  return launchdSupported() && process.argv.includes(LAUNCHD_MANAGED_ARG)
}

function guiDomain(): string {
  return `gui/${process.getuid?.() ?? 0}`
}

// A manually launched instance (Finder, Spotlight, stale login item) runs
// outside launchd supervision, so nothing would relaunch it after a kill.
// Called once this instance holds the single-instance lock: release the lock,
// start the supervised job and exit. Bootstrap also re-loads a job booted out
// by an earlier tray Quit — a deliberate manual launch opts back in.
export function handoffToLaunchd(): void {
  if (!launchdSupported() || process.argv.includes(LAUNCHD_MANAGED_ARG)) {
    return
  }

  app.releaseSingleInstanceLock()
  try {
    try {
      execFileSync('launchctl', ['bootstrap', guiDomain(), PLIST_PATH], {
        timeout: LAUNCHCTL_TIMEOUT_MS,
      })
    } catch {
      // Already loaded — kickstart below starts it if needed.
    }
    execFileSync('launchctl', ['kickstart', `${guiDomain()}/${LABEL}`], {
      timeout: LAUNCHCTL_TIMEOUT_MS,
    })
    log.info('[Launchd] Handed off to the supervised LaunchAgent instance')
    app.exit(0)
  } catch (error) {
    log.warn('[Launchd] Handoff failed, continuing unsupervised:', error)
    // Bootstrap may still have launched the supervised instance; if it took
    // the lock in the meantime, yield to it like any lost instance race.
    if (!app.requestSingleInstanceLock()) {
      app.quit()
    }
  }
}

// Explicit quit must hold: unload the job so KeepAlive cannot resurrect the
// app. The bootout SIGTERMs this process, which re-enters the graceful quit
// path — callers treat that the same as their own app.quit().
export async function disableLaunchdSupervision(): Promise<void> {
  if (!launchdSupported()) {
    return
  }

  try {
    await execFileAsync('launchctl', ['bootout', `${guiDomain()}/${LABEL}`], {
      timeout: LAUNCHCTL_TIMEOUT_MS,
    })
    log.info('[Launchd] LaunchAgent booted out for explicit quit')
  } catch (error) {
    log.warn('[Launchd] Failed to boot out LaunchAgent:', error)
  }
}
