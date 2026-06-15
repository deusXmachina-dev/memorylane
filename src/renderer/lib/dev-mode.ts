/**
 * Hidden Developer mode (for the in-app eval recorder). Not security, just
 * obscurity — the eval IPC handlers ship in every build and are inert until the
 * UI invokes them. Enabled by 7 rapid taps on the Settings title; disabled only
 * via an explicit button in the Developer tab.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'memorylane:devMode'
const UNLOCK_TAPS = 7
/** Tap streak resets after this long so stray clicks can't accumulate. */
const TAP_RESET_MS = 600

export function isDevMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function setDevMode(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(STORAGE_KEY, '1')
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore storage failures
  }
  window.dispatchEvent(new Event('memorylane:devModeChanged'))
}

/** Reactive dev-mode flag, kept in sync across components via a window event. */
export function useDevMode(): boolean {
  const [enabled, setEnabled] = useState(isDevMode)
  useEffect(() => {
    const sync = (): void => setEnabled(isDevMode())
    window.addEventListener('memorylane:devModeChanged', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('memorylane:devModeChanged', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  return enabled
}

/**
 * Returns an `onClick` to attach to an existing element. Counts rapid taps and
 * fires `onUnlock` on the Nth; the streak resets after a pause. No-op once dev
 * mode is already on.
 */
export function useTapUnlock(onUnlock: () => void): () => void {
  const count = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  return useCallback(() => {
    if (isDevMode()) return
    count.current += 1
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      count.current = 0
    }, TAP_RESET_MS)
    if (count.current >= UNLOCK_TAPS) {
      count.current = 0
      if (timer.current) clearTimeout(timer.current)
      onUnlock()
    }
  }, [onUnlock])
}
