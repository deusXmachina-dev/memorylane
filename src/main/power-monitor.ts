import { powerMonitor } from 'electron'
import log from './logger'

type PowerStateCallback = () => void

let onPauseCallback: PowerStateCallback | null = null
let onResumeCallback: PowerStateCallback | null = null

let screenLocked = false
let suspended = false
let onBattery = false

export function shouldPause(): boolean {
  return screenLocked || suspended
}

export function shouldThrottle(): boolean {
  return onBattery
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
    emitIfNeeded()
  })

  powerMonitor.on('resume', () => {
    log.info('[Power] System resumed')
    suspended = false
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
