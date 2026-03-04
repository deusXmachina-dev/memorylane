import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { SlackIntegrationConfig, SlackIntegrationStatus } from '../../../shared/types'
import log from '../../logger'
import type { SlackRuntimeConfig, SlackRuntimeState } from './types'

type StoredConfig = {
  enabled: boolean
  ownerUserId: string
  watchedChannelIds: string[]
  pollIntervalMs: number
  allwaysApprove: boolean
  encryptedBotToken?: string
}

const DEFAULTS: StoredConfig = {
  enabled: false,
  ownerUserId: '',
  watchedChannelIds: [],
  pollIntervalMs: 30_000,
  allwaysApprove: true,
}

function parseChannelIds(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean)
}

export class SlackSettingsManager {
  private readonly configPath: string

  constructor(configPath?: string) {
    this.configPath =
      configPath ?? path.join(app.getPath('userData'), 'slack-integration-settings.json')
  }

  private loadStored(): StoredConfig {
    try {
      if (!fs.existsSync(this.configPath)) {
        return { ...DEFAULTS }
      }

      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf-8')) as Partial<StoredConfig>
      return {
        ...DEFAULTS,
        ...parsed,
        watchedChannelIds: Array.isArray(parsed.watchedChannelIds)
          ? parsed.watchedChannelIds.filter((value): value is string => typeof value === 'string')
          : [],
      }
    } catch (error) {
      log.warn('[SlackSettings] Failed to load settings, using defaults:', error)
      return { ...DEFAULTS }
    }
  }

  private writeStored(config: StoredConfig): void {
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2))
  }

  private decryptBotToken(encoded: string | undefined): string | null {
    if (!encoded) return null
    if (!safeStorage.isEncryptionAvailable()) {
      log.warn('[SlackSettings] Secure storage not available, cannot decrypt bot token')
      return null
    }

    try {
      return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
    } catch (error) {
      log.warn('[SlackSettings] Failed to decrypt bot token:', error)
      return null
    }
  }

  private maskToken(token: string | null): string | null {
    if (!token) return null
    if (token.length <= 12) return '****'
    return `${token.slice(0, 6)}...${token.slice(-4)}`
  }

  public getStatus(runtimeState?: Partial<SlackRuntimeState>): SlackIntegrationStatus {
    const stored = this.loadStored()
    const botToken = this.decryptBotToken(stored.encryptedBotToken)

    return {
      enabled: stored.enabled,
      running: runtimeState?.running ?? false,
      hasBotToken: botToken !== null,
      maskedBotToken: this.maskToken(botToken),
      ownerUserId: stored.ownerUserId,
      watchedChannelIds: stored.watchedChannelIds.join(', '),
      pollIntervalMs: stored.pollIntervalMs,
      allwaysApprove: stored.allwaysApprove,
      lastError: runtimeState?.lastError ?? null,
    }
  }

  public getRuntimeConfig(): SlackRuntimeConfig {
    const stored = this.loadStored()
    return {
      enabled: stored.enabled,
      botToken: this.decryptBotToken(stored.encryptedBotToken),
      ownerUserId: stored.ownerUserId,
      watchedChannelIds: [...stored.watchedChannelIds],
      pollIntervalMs: stored.pollIntervalMs,
      allwaysApprove: stored.allwaysApprove,
    }
  }

  public save(config: SlackIntegrationConfig): void {
    const current = this.loadStored()
    const next: StoredConfig = {
      enabled: config.enabled,
      ownerUserId: config.ownerUserId.trim(),
      watchedChannelIds: parseChannelIds(config.watchedChannelIds),
      pollIntervalMs: config.pollIntervalMs,
      allwaysApprove: config.allwaysApprove,
      encryptedBotToken: current.encryptedBotToken,
    }

    if (!Number.isFinite(config.pollIntervalMs) || config.pollIntervalMs < 10_000) {
      throw new Error('Poll interval must be at least 10000 ms')
    }

    const nextToken = config.botToken?.trim()
    if (nextToken) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Secure storage is not available on this system')
      }
      next.encryptedBotToken = safeStorage.encryptString(nextToken).toString('base64')
    }

    const hasBotToken = this.decryptBotToken(next.encryptedBotToken) !== null
    const needsOwner = !next.allwaysApprove
    if (
      next.enabled &&
      (!hasBotToken || next.watchedChannelIds.length === 0 || (needsOwner && !next.ownerUserId))
    ) {
      throw new Error(
        needsOwner
          ? 'Enabled Slack integration requires bot token, owner user ID, and channels'
          : 'Enabled Slack integration requires bot token and channels',
      )
    }

    this.writeStored(next)
    log.info('[SlackSettings] Settings saved')
  }

  public reset(): void {
    if (fs.existsSync(this.configPath)) {
      fs.unlinkSync(this.configPath)
    }
    log.info('[SlackSettings] Settings reset')
  }
}
