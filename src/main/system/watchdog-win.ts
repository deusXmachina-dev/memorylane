import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import { AUTO_START_HIDDEN_ARG } from '@main/system/auto-start'
import { loadAppEditionConfig } from '@main/system/edition'
import log from '@main/utils/logger'

const execFileAsync = promisify(execFile)

// The HKCU Run autostart only fires at login, so an external kill mid-session
// (RMM/AV/MDM) leaves the app dead until the user next logs in. This per-user
// scheduled task relaunches it within minutes instead. An explicit tray Quit
// disables the task so the user's choice holds until the next launch (the
// login item re-registers it). Registration deliberately ignores the
// auto-start setting: that setting governs login behavior, while enterprise
// devices must recover from mid-session kills regardless.
//
// MDM removal scripts should `schtasks /Delete /F /TN "<TASK_NAME>"` — a task
// disabled by tray Quit never runs again and would linger after uninstall.
const TASK_NAME = 'MemoryLane Enterprise Watchdog'
const RELAUNCH_INTERVAL_MINUTES = 5
const SCHTASKS_TIMEOUT_MS = 5_000

function watchdogSupported(): boolean {
  return (
    process.platform === 'win32' &&
    app.isPackaged &&
    loadAppEditionConfig().edition === 'enterprise'
  )
}

export function buildCreateTaskArgs(scriptPath: string, executablePath: string): string[] {
  return [
    '/Create',
    '/F',
    '/TN',
    TASK_NAME,
    '/SC',
    'MINUTE',
    '/MO',
    String(RELAUNCH_INTERVAL_MINUTES),
    // Runs the VBS script rather than the exe directly — see
    // assets/watchdog-relaunch.vbs for why.
    '/TR',
    `wscript.exe //B "${scriptPath}" "${executablePath}" ${AUTO_START_HIDDEN_ARG} "${TASK_NAME}"`,
  ]
}

async function runSchtasks(args: string[]): Promise<void> {
  await execFileAsync('schtasks.exe', args, {
    windowsHide: true,
    timeout: SCHTASKS_TIMEOUT_MS,
  })
}

export async function ensureWatchdogTask(): Promise<void> {
  if (!watchdogSupported()) {
    return
  }

  try {
    const scriptPath = path.join(process.resourcesPath, 'assets', 'watchdog-relaunch.vbs')
    await runSchtasks(buildCreateTaskArgs(scriptPath, process.execPath))
    log.info(`[Watchdog] Relaunch task registered (every ${RELAUNCH_INTERVAL_MINUTES} min)`)
  } catch (error) {
    log.warn('[Watchdog] Failed to register relaunch task:', error)
  }
}

export async function disableWatchdogTask(): Promise<void> {
  if (!watchdogSupported()) {
    return
  }

  try {
    await runSchtasks(['/Change', '/TN', TASK_NAME, '/DISABLE'])
    log.info('[Watchdog] Relaunch task disabled')
  } catch (error) {
    log.warn('[Watchdog] Failed to disable relaunch task:', error)
  }
}
