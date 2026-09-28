import { powerMonitor } from 'electron'
import log from '@main/utils/logger'

type PowerStateCallback = () => void

let onPauseCallback: PowerStateCallback | null = null
let onResumeCallback: PowerStateCallback | null = null

let screenLocked = false
let suspended = false
let onBattery = false
let lastSuspendAt = 0
const suspendListeners = new Set<() => void>()
const resumeListeners = new Set<() => void>()

export function shouldPause(): boolean {
  return screenLocked || suspended
}

export function shouldThrottle(): boolean {
  return onBattery
}

/** Still true through a macOS dark wake, which runs timers without emitting 'resume'. */
export function isSuspended(): boolean {
  return suspended
}

/** Epoch ms of the last system suspend, 0 if none since launch. */
export function getLastSuspendAt(): number {
  return lastSuspendAt
}

export function onSuspend(listener: () => void): () => void {
  suspendListeners.add(listener)
  return () => {
    suspendListeners.delete(listener)
  }
}

export function onResume(listener: () => void): () => void {
  resumeListeners.add(listener)
  return () => {
    resumeListeners.delete(listener)
  }
}

/** Seconds since the last system-wide user input (mouse move counts), per the OS. */
export function getSystemIdleSeconds(): number {
  return powerMonitor.getSystemIdleTime()
}

function emitIfNeeded(): void {
  const pause = shouldPause()
  log.info(
    `[Power] State: screenLocked=${screenLocked}, suspended=${suspended}, onBattery=${onBattery} → ${pause ? 'pause' : 'resume'}`,
  )
  if (pause) {
    onPauseCallback?.()
  } else {
    onResumeCallback?.()
  }
}

export function startPowerMonitoring(opts: {
  onPause: PowerStateCallback
  onResume: PowerStateCallback
}): void {
  onPauseCallback = opts.onPause
  onResumeCallback = opts.onResume

  onBattery = powerMonitor.isOnBatteryPower()

  powerMonitor.on('lock-screen', () => {
    log.info('[Power] Screen locked')
    screenLocked = true
    emitIfNeeded()
  })

  powerMonitor.on('unlock-screen', () => {
    log.info('[Power] Screen unlocked')
    screenLocked = false
    emitIfNeeded()
  })

  powerMonitor.on('suspend', () => {
    log.info('[Power] System suspended')
    suspended = true
    lastSuspendAt = Date.now()
    for (const listener of suspendListeners) listener()
    emitIfNeeded()
  })

  powerMonitor.on('resume', () => {
    log.info('[Power] System resumed')
    suspended = false
    for (const listener of resumeListeners) listener()
    emitIfNeeded()
  })

  powerMonitor.on('on-ac', () => {
    log.info('[Power] Switched to AC power')
    onBattery = false
  })

  powerMonitor.on('on-battery', () => {
    log.info('[Power] Switched to battery power')
    onBattery = true
  })

  log.info(`[Power] Monitoring started (onBattery=${onBattery})`)
}
