/**
 * macOS permissions management for Accessibility and Screen Recording.
 *
 * Exposes pure status getters and idempotent request triggers so the renderer
 * can drive the onboarding permission step. The legacy blocking
 * `ensurePermissions()` flow has been removed — startup no longer waits on a
 * native prompt, and we no longer auto-relaunch after screen-recording grant.
 */

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

/**
 * Open the macOS System Settings pane for the given permission.
 *
 * Uses `open(1)` via child_process — more reliable than shell.openExternal
 * for `x-apple.systempreferences:` URLs, which silently no-op on some recent
 * macOS versions when System Settings is already running.
 */
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

/**
 * Trigger the screen-recording grant flow by attempting a capture. macOS only adds
 * an app to the Screen Recording list once it tries to capture, so a throwaway 1px
 * getSources() both registers the app and surfaces macOS's native consent prompt
 * (which carries its own "Open System Settings" button) as the single surface.
 */
export async function requestScreenRecording(): Promise<void> {
  if (process.platform !== 'darwin') return
  if (systemPreferences.getMediaAccessStatus('screen') === 'granted') return
  try {
    await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
  } catch (err) {
    log.debug(
      `[Permissions] screen capture attempt rejected: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
