// macOS permissions management for Accessibility and Screen Recording.

import { spawn } from 'node:child_process'
import { systemPreferences, shell, desktopCapturer } from 'electron'
import log from '../logger'

export type PermissionState = 'granted' | 'denied' | 'unknown'

export interface PermissionStatus {
  accessibility: PermissionState
  screenRecording: PermissionState
}

/**
 * Read current permission status without prompting the user.
 * Non-macOS platforms report both as granted.
 */
export function getPermissionStatus(): PermissionStatus {
  if (process.platform !== 'darwin') {
    return { accessibility: 'granted', screenRecording: 'granted' }
  }

  const accessibility: PermissionState = systemPreferences.isTrustedAccessibilityClient(false)
    ? 'granted'
    : 'denied'

  const mediaStatus = systemPreferences.getMediaAccessStatus('screen')
  let screenRecording: PermissionState
  if (mediaStatus === 'granted') screenRecording = 'granted'
  else if (mediaStatus === 'not-determined' || mediaStatus === 'unknown')
    screenRecording = 'unknown'
  else screenRecording = 'denied'

  return { accessibility, screenRecording }
}

// Uses open(1) rather than shell.openExternal — the latter silently no-ops for
// x-apple.systempreferences: URLs when System Settings is already running.
export async function openPermissionSettings(
  kind: 'accessibility' | 'screenRecording',
): Promise<void> {
  if (process.platform !== 'darwin') return
  const url =
    kind === 'accessibility'
      ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
      : 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
  log.info(`[Permissions] openPermissionSettings(${kind}) → ${url}`)
  try {
    const child = spawn('open', [url], { detached: true, stdio: 'ignore' })
    child.on('error', (err) => {
      log.warn(`[Permissions] open(1) failed: ${err instanceof Error ? err.message : String(err)}`)
    })
    child.unref()
  } catch (err) {
    log.warn(
      `[Permissions] spawn open failed (${err instanceof Error ? err.message : String(err)}); falling back to shell.openExternal`,
    )
    await shell.openExternal(url)
  }
}

// macOS reports 'denied' for both not-determined and denied screen recording, so
// we fall back to the attempt count: first click captures (registers the app and
// fires the native prompt), later clicks open Settings (the prompt won't refire).
let hasAttemptedScreenCapture = false

export async function requestScreenRecording(): Promise<void> {
  if (process.platform !== 'darwin') return
  if (systemPreferences.getMediaAccessStatus('screen') === 'granted') return
  if (hasAttemptedScreenCapture) {
    await openPermissionSettings('screenRecording')
    return
  }
  hasAttemptedScreenCapture = true
  try {
    await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
  } catch (err) {
    log.debug(
      `[Permissions] screen capture attempt rejected: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
