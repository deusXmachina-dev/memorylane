import { app, safeStorage } from 'electron'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import log from '../logger'
import { createPublicInstallationId } from './public-installation-id'

/**
 * Thrown when an identity file exists but cannot be read right now (secure
 * storage unavailable, decryption failed, corrupt file). Signals a transient
 * condition: callers must retry later rather than treat it as a missing
 * identity. We never regenerate in this case — doing so would overwrite the
 * existing id (and the subscription bound to it) over a recoverable hiccup.
 */
export class DeviceIdentityUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DeviceIdentityUnavailableError'
  }
}

type LoadResult =
  | { status: 'ok'; deviceId: string }
  | { status: 'absent' }
  | { status: 'unreadable'; reason: string; cause?: unknown }

export class DeviceIdentity {
  private configPath: string
  private cached: string | null = null

  constructor() {
    this.configPath = path.join(app.getPath('userData'), 'device-identity.json')
  }

  /**
   * Get the device ID, creating and persisting it on first call.
   * This is a cryptographically random 256-bit token that serves as
   * both identifier and credential for backend authentication.
   */
  public getDeviceId(): string {
    if (this.cached) {
      return this.cached
    }

    const stored = this.loadStored()
    if (stored.status === 'ok') {
      this.cached = stored.deviceId
      return stored.deviceId
    }

    // An existing identity we just can't read: never regenerate, or we'd
    // overwrite the id the subscription is bound to over a recoverable hiccup.
    if (stored.status === 'unreadable') {
      log.warn(`[DeviceIdentity] Device ID unreadable (${stored.reason}); not regenerating`)
      throw new DeviceIdentityUnavailableError(
        `Device identity exists but is currently unreadable: ${stored.reason}`,
        { cause: stored.cause },
      )
    }

    // status === 'absent': genuine first run, the only time we generate.
    const deviceId = crypto.randomBytes(32).toString('hex')
    try {
      this.persist(deviceId)
    } catch (error) {
      // Don't cache an ephemeral, never-persisted id — that would guarantee a
      // different id next launch. Surface as transient so callers retry.
      log.warn('[DeviceIdentity] Failed to persist new device ID:', error)
      throw new DeviceIdentityUnavailableError('Could not persist a new device identity', {
        cause: error,
      })
    }
    this.cached = deviceId

    log.info('[DeviceIdentity] Generated new device ID')
    return deviceId
  }

  public getPublicInstallationId(): string {
    return createPublicInstallationId(this.getDeviceId())
  }

  private persist(deviceId: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is not available on this system')
    }

    const encrypted = safeStorage.encryptString(deviceId).toString('base64')
    fs.writeFileSync(this.configPath, JSON.stringify({ deviceId: encrypted }, null, 2))
    log.info('[DeviceIdentity] Device ID persisted securely')
  }

  private loadStored(): LoadResult {
    if (!fs.existsSync(this.configPath)) {
      return { status: 'absent' }
    }

    // File exists but we can't decrypt right now — unreadable, not absent.
    if (!safeStorage.isEncryptionAvailable()) {
      log.warn('[DeviceIdentity] Secure storage not available, cannot decrypt device ID')
      return { status: 'unreadable', reason: 'secure storage unavailable' }
    }

    try {
      const configData = fs.readFileSync(this.configPath, 'utf-8')
      const config = JSON.parse(configData)

      if (!config.deviceId) {
        return { status: 'unreadable', reason: 'stored file missing deviceId field' }
      }

      return {
        status: 'ok',
        deviceId: safeStorage.decryptString(Buffer.from(config.deviceId, 'base64')),
      }
    } catch (error) {
      log.error('[DeviceIdentity] Error reading stored device ID:', error)
      return { status: 'unreadable', reason: 'read or decrypt failed', cause: error }
    }
  }
}
