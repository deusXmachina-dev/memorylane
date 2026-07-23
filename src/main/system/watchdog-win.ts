import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AUTO_START_HIDDEN_ARG } from '@main/system/auto-start'
import { isPackagedElectronExecutable } from '@main/utils/paths'
import log from '@main/utils/logger'

const execFileAsync = promisify(execFile)

// The HKCU Run autostart only fires at login, so an external kill mid-session
// (RMM/AV/MDM) leaves the app dead until the user next logs in. This per-user
// scheduled task relaunches it within minutes instead. When the app is already
// running the relaunch loses the single-instance lock and exits immediately.
// An explicit tray Quit disables the task so the user's choice holds until the
// next launch (the login item re-registers it).
const TASK_NAME = 'MemoryLane Enterprise Watchdog'
const RELAUNCH_INTERVAL_MINUTES = 5
const SCHTASKS_TIMEOUT_MS = 5_000

let registered = false

export function buildCreateTaskArgs(executablePath: string): string[] {
  return [
    '/Create',
    '/F',
    '/TN',
    TASK_NAME,
    '/SC',
    'MINUTE',
    '/MO',
    String(RELAUNCH_INTERVAL_MINUTES),
    '/TR',
    `"${executablePath}" ${AUTO_START_HIDDEN_ARG}`,
  ]
}

export function buildDisableTaskArgs(): string[] {
  return ['/Change', '/TN', TASK_NAME, '/DISABLE']
}

async function runSchtasks(args: string[]): Promise<void> {
  await execFileAsync('schtasks.exe', args, {
    windowsHide: true,
    timeout: SCHTASKS_TIMEOUT_MS,
  })
}

export async function ensureWatchdogTask(): Promise<void> {
  if (process.platform !== 'win32' || !isPackagedElectronExecutable(process.execPath)) {
    return
  }

  try {
    await runSchtasks(buildCreateTaskArgs(process.execPath))
    registered = true
    log.info(`[Watchdog] Relaunch task registered (every ${RELAUNCH_INTERVAL_MINUTES} min)`)
  } catch (error) {
    log.warn('[Watchdog] Failed to register relaunch task:', error)
  }
}

export async function disableWatchdogTask(): Promise<void> {
  if (!registered) {
    return
  }

  try {
    await runSchtasks(buildDisableTaskArgs())
    log.info('[Watchdog] Relaunch task disabled after explicit quit')
  } catch (error) {
    log.warn('[Watchdog] Failed to disable relaunch task:', error)
  }
}
