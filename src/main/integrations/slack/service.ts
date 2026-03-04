import { LogLevel, WebClient } from '@slack/web-api'
import log from '../../logger'
import {
  buildDraftReply,
  compareTs,
  formatApprovalText,
  getNewestTs,
  hasReactionFromUser,
  isPlainUserMessage,
  summarizeSourceText,
} from './messages'
import { SlackSettingsManager } from './settings-manager'
import type { PendingApproval, SlackMessage, SlackRuntimeConfig, SlackRuntimeState } from './types'

export class SlackIntegrationService {
  private running = false
  private lastError: string | null = null
  private client: WebClient | null = null
  private activeConfig: SlackRuntimeConfig | null = null
  private ownerDmChannelId = ''
  private botUserId = ''
  private intervalId: NodeJS.Timeout | null = null
  private pollInFlight = false
  private pendingApprovals = new Map<string, PendingApproval>()
  private lastSeenByChannel = new Map<string, string>()

  constructor(private readonly settingsManager: SlackSettingsManager) {}

  public getRuntimeState(): SlackRuntimeState {
    return {
      running: this.running,
      lastError: this.lastError,
    }
  }

  public async reload(): Promise<void> {
    await this.stop()

    const config = this.settingsManager.getRuntimeConfig()
    if (!config.enabled) {
      this.lastError = null
      return
    }

    if (
      !config.botToken ||
      config.watchedChannelIds.length === 0 ||
      (!config.allwaysApprove && !config.ownerUserId)
    ) {
      this.lastError = 'Slack integration is enabled but incomplete'
      return
    }

    try {
      await this.start(config)
      this.lastError = null
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      log.error('[SlackIntegration] Failed to start:', error)
      await this.stop()
    }
  }

  public async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }

    this.running = false
    this.client = null
    this.activeConfig = null
    this.ownerDmChannelId = ''
    this.botUserId = ''
    this.pollInFlight = false
    this.pendingApprovals.clear()
    this.lastSeenByChannel.clear()
  }

  private async start(config: SlackRuntimeConfig): Promise<void> {
    const client = new WebClient(config.botToken ?? undefined, {
      logLevel: process.env.SLACK_DEBUG === '1' ? LogLevel.DEBUG : LogLevel.INFO,
    })

    const auth = await client.auth.test()
    this.client = client
    this.activeConfig = config
    this.botUserId = auth.user_id ?? ''

    await this.seedState()
    this.running = true
    log.info(
      `[SlackIntegration] Running for ${config.ownerUserId}. Watching ${config.watchedChannelIds.join(', ')}`,
    )

    await this.runPollCycle()
    this.intervalId = setInterval(() => {
      void this.runPollCycle()
    }, config.pollIntervalMs)
  }

  private async ensureOwnerDmChannelId(): Promise<string> {
    if (!this.client || !this.activeConfig) throw new Error('Slack client not initialized')
    if (this.ownerDmChannelId) return this.ownerDmChannelId

    const dm = await this.client.conversations.open({
      users: this.activeConfig.ownerUserId,
    })

    const channelId = dm.channel?.id
    if (!channelId) {
      throw new Error(`Could not open DM channel for ${this.activeConfig.ownerUserId}`)
    }

    this.ownerDmChannelId = channelId
    return channelId
  }

  private async getLatestMessageTs(channel: string): Promise<string> {
    if (!this.client) throw new Error('Slack client not initialized')

    const response = await this.client.conversations.history({
      channel,
      limit: 1,
    })

    const messages = (response.messages ?? []) as SlackMessage[]
    return messages[0]?.ts ?? '0'
  }

  private async postOwnerDm(text: string): Promise<string> {
    if (!this.client) throw new Error('Slack client not initialized')

    const channel = await this.ensureOwnerDmChannelId()
    const response = await this.client.chat.postMessage({
      channel,
      text,
    })

    if (!response.ts) {
      throw new Error('Slack did not return a message timestamp for the DM message')
    }

    return response.ts
  }

  private async queueApproval(message: SlackMessage, sourceChannelId: string): Promise<void> {
    if (!this.client || !this.activeConfig) throw new Error('Slack client not initialized')

    const sourceText = summarizeSourceText(message.text ?? '')
    const replyText = buildDraftReply(sourceText)

    if (this.activeConfig.allwaysApprove) {
      await this.client.chat.postMessage({
        channel: sourceChannelId,
        thread_ts: message.thread_ts ?? message.ts,
        text: replyText,
      })
      log.info(`[SlackIntegration] Auto-approved ${sourceChannelId}:${message.ts}`)
      return
    }

    const pending: PendingApproval = {
      sourceChannelId,
      sourceThreadTs: message.thread_ts ?? message.ts,
      sourceUserId: message.user ?? '',
      sourceText,
      replyText,
      approvalMessageTs: '',
    }

    pending.approvalMessageTs = await this.postOwnerDm(formatApprovalText(pending))
    this.pendingApprovals.set(pending.approvalMessageTs, pending)
    log.info(`[SlackIntegration] Queued approval for ${sourceChannelId}:${message.ts}`)
  }

  private async pollWatchedChannels(): Promise<void> {
    if (!this.client || !this.activeConfig) throw new Error('Slack client not initialized')

    for (const channelId of this.activeConfig.watchedChannelIds) {
      const oldest = this.lastSeenByChannel.get(channelId) ?? '0'
      const response = await this.client.conversations.history({
        channel: channelId,
        oldest,
        inclusive: false,
        limit: 15,
      })

      const messages = ((response.messages ?? []) as SlackMessage[])
        .filter((message) => isPlainUserMessage(message) && message.user !== this.botUserId)
        .sort((left, right) => compareTs(left.ts, right.ts))

      if (messages.length === 0) continue

      for (const message of messages) {
        await this.queueApproval(message, channelId)
      }

      this.lastSeenByChannel.set(channelId, getNewestTs(messages, oldest))
    }
  }

  private async pollApprovalDecisions(): Promise<void> {
    if (
      !this.client ||
      !this.activeConfig ||
      this.activeConfig.allwaysApprove ||
      this.pendingApprovals.size === 0
    ) {
      return
    }

    const channel = await this.ensureOwnerDmChannelId()
    const response = await this.client.conversations.history({
      channel,
      limit: 100,
    })

    const messages = new Map(
      ((response.messages ?? []) as SlackMessage[]).map((message) => [message.ts, message]),
    )

    for (const pending of [...this.pendingApprovals.values()]) {
      const approvalMessage = messages.get(pending.approvalMessageTs)
      const reactions = approvalMessage?.reactions
      const isApproved = hasReactionFromUser(
        reactions,
        ['+1', 'thumbsup', 'white_check_mark'],
        this.activeConfig.ownerUserId,
      )
      const isRejected = hasReactionFromUser(
        reactions,
        ['-1', 'thumbsdown', 'x'],
        this.activeConfig.ownerUserId,
      )

      if (!isApproved && !isRejected) continue

      this.pendingApprovals.delete(pending.approvalMessageTs)

      if (isRejected && !isApproved) {
        continue
      }

      await this.client.chat.postMessage({
        channel: pending.sourceChannelId,
        thread_ts: pending.sourceThreadTs,
        text: pending.replyText,
      })
    }
  }

  private async seedState(): Promise<void> {
    if (!this.activeConfig) throw new Error('Slack config not initialized')

    for (const channelId of this.activeConfig.watchedChannelIds) {
      this.lastSeenByChannel.set(channelId, await this.getLatestMessageTs(channelId))
    }

    if (!this.activeConfig.allwaysApprove) {
      await this.ensureOwnerDmChannelId()
    }
  }

  private async runPollCycle(): Promise<void> {
    if (this.pollInFlight) {
      log.warn('[SlackIntegration] Skipping poll cycle because the previous cycle is still running')
      return
    }

    this.pollInFlight = true
    try {
      await this.pollWatchedChannels()
      await this.pollApprovalDecisions()
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      log.error('[SlackIntegration] Poll cycle failed:', error)
    } finally {
      this.pollInFlight = false
    }
  }
}
