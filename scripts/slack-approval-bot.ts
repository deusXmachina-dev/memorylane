#!/usr/bin/env npx tsx

import 'dotenv/config'

import { LogLevel, WebClient } from '@slack/web-api'

type BotConfig = {
  ownerUserId: string
  watchedChannelIds: Set<string>
  pollIntervalMs: number
  allwaysApprove: boolean
}

type SlackMessage = {
  ts: string
  text?: string
  user?: string
  bot_id?: string
  subtype?: string
  thread_ts?: string
  reactions?: SlackReaction[]
}

type SlackReaction = {
  name: string
  users?: string[]
}

type PendingApproval = {
  sourceChannelId: string
  sourceMessageTs: string
  sourceThreadTs: string
  sourceUserId: string
  sourceText: string
  replyText: string
  approvalPreviewText: string
  approvalMessageTs: string
}

const DEFAULT_POLL_INTERVAL_MS = 120_000

const HELP_TEXT = `MemoryLane Slack approval bot

Required environment variables:
  SLACK_BOT_TOKEN=xoxb-...
  SLACK_OWNER_USER_ID=U12345678
  SLACK_WATCH_CHANNEL_IDS=C12345678,C23456789

Optional:
  SLACK_POLL_INTERVAL_MS=120000
  SLACK_ALLWAYS_APPROVE=1

Run:
  npx tsx scripts/slack-approval-bot.ts
  npm run slack:approval-bot

Approval flow:
  The bot polls watched channels for new messages.
  It DMs the configured owner with a draft preview.
  React to the approval message in the DM with:
    :+1: to approve
    :-1: to reject

Flags:
  --help          Show this message
  --check-config  Validate environment and exit
`

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function parseChannelIds(): Set<string> {
  const ids = getRequiredEnv('SLACK_WATCH_CHANNEL_IDS')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (ids.length === 0) {
    throw new Error('SLACK_WATCH_CHANNEL_IDS must contain at least one channel ID')
  }

  return new Set(ids)
}

function parsePollIntervalMs(): number {
  const raw = process.env.SLACK_POLL_INTERVAL_MS?.trim()
  if (!raw) return DEFAULT_POLL_INTERVAL_MS

  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value < 10_000) {
    throw new Error('SLACK_POLL_INTERVAL_MS must be an integer >= 10000')
  }

  return value
}

function parseAllwaysApprove(): boolean {
  const raw = process.env.SLACK_ALLWAYS_APPROVE?.trim()
  if (!raw) return true

  return raw === '1' || raw.toLowerCase() === 'true'
}

function loadConfig(): BotConfig {
  return {
    ownerUserId: getRequiredEnv('SLACK_OWNER_USER_ID'),
    watchedChannelIds: parseChannelIds(),
    pollIntervalMs: parsePollIntervalMs(),
    allwaysApprove: parseAllwaysApprove(),
  }
}

function isPlainUserMessage(
  message: SlackMessage | undefined,
  expectedUserId?: string,
): message is SlackMessage {
  if (!message) return false
  if (message.subtype !== undefined) return false
  if (typeof message.user !== 'string' || message.user.length === 0) return false
  if (expectedUserId && message.user !== expectedUserId) return false
  if (typeof message.bot_id === 'string' && message.bot_id.length > 0) return false
  return typeof message.text === 'string' && message.text.trim().length > 0
}

function summarizeSourceText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= 220 ? normalized : `${normalized.slice(0, 217)}...`
}

function buildDraftReply(sourceText: string): string {
  return `Thanks, I saw your message: ${sourceText}`
}

function formatApprovalText(pending: PendingApproval): string {
  return [
    '*Approve reply?*',
    `Channel: <#${pending.sourceChannelId}>`,
    `From: <@${pending.sourceUserId}>`,
    `Original: ${pending.sourceText}`,
    '',
    '*Draft reply*',
    pending.approvalPreviewText,
    '',
    'React with :+1: to approve or :-1: to reject.',
  ].join('\n')
}

function compareTs(left: string, right: string): number {
  return Number.parseFloat(left) - Number.parseFloat(right)
}

function getNewestTs(messages: SlackMessage[], fallback: string): string {
  return messages.reduce(
    (latest, message) => (compareTs(message.ts, latest) > 0 ? message.ts : latest),
    fallback,
  )
}

function hasReactionFromUser(
  message: SlackMessage | undefined,
  reactionNames: readonly string[],
  userId: string,
): boolean {
  if (!message?.reactions) return false

  return message.reactions.some(
    (reaction) =>
      reactionNames.includes(reaction.name) &&
      Array.isArray(reaction.users) &&
      reaction.users.includes(userId),
  )
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log(HELP_TEXT)
    return
  }

  const config = loadConfig()

  if (process.argv.includes('--check-config')) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          ownerUserId: config.ownerUserId,
          watchedChannelIds: [...config.watchedChannelIds],
          pollIntervalMs: config.pollIntervalMs,
          allwaysApprove: config.allwaysApprove,
        },
        null,
        2,
      ),
    )
    return
  }

  const client = new WebClient(getRequiredEnv('SLACK_BOT_TOKEN'), {
    logLevel: process.env.SLACK_DEBUG === '1' ? LogLevel.DEBUG : LogLevel.INFO,
  })

  const auth = await client.auth.test()
  const teamName = auth.team ?? 'unknown-team'
  const botUserId = auth.user_id ?? 'unknown-bot-user'

  const pendingApprovals = new Map<string, PendingApproval>()
  const lastSeenByChannel = new Map<string, string>()
  let ownerDmChannelId = ''
  let pollInFlight = false

  async function ensureOwnerDmChannelId(): Promise<string> {
    if (ownerDmChannelId) return ownerDmChannelId

    const dm = await client.conversations.open({
      users: config.ownerUserId,
    })

    const channelId = dm.channel?.id
    if (!channelId) {
      throw new Error(`Could not open DM channel for ${config.ownerUserId}`)
    }

    ownerDmChannelId = channelId
    return channelId
  }

  async function getLatestMessageTs(channel: string): Promise<string> {
    const response = await client.conversations.history({
      channel,
      limit: 1,
    })

    const messages = (response.messages ?? []) as SlackMessage[]
    return messages[0]?.ts ?? '0'
  }

  async function postOwnerDm(text: string): Promise<string> {
    const channel = await ensureOwnerDmChannelId()
    const response = await client.chat.postMessage({
      channel,
      text,
    })

    if (!response.ts) {
      throw new Error('Slack did not return a message timestamp for the DM message')
    }

    return response.ts
  }

  async function queueApproval(message: SlackMessage, sourceChannelId: string): Promise<void> {
    const sourceText = summarizeSourceText(message.text ?? '')
    const replyText = buildDraftReply(sourceText)

    if (config.allwaysApprove) {
      await client.chat.postMessage({
        channel: sourceChannelId,
        thread_ts: message.thread_ts ?? message.ts,
        text: replyText,
      })
      console.log(`Auto-approved ${sourceChannelId}:${message.ts}`)
      return
    }

    const pending: PendingApproval = {
      sourceChannelId,
      sourceMessageTs: message.ts,
      sourceThreadTs: message.thread_ts ?? message.ts,
      sourceUserId: message.user ?? '',
      sourceText,
      replyText,
      approvalPreviewText: replyText,
      approvalMessageTs: '',
    }

    pending.approvalMessageTs = await postOwnerDm(formatApprovalText(pending))
    pendingApprovals.set(pending.approvalMessageTs, pending)
    console.log(`Queued approval for ${pending.sourceChannelId}:${pending.sourceMessageTs}`)
  }

  async function pollWatchedChannels(): Promise<void> {
    for (const channelId of config.watchedChannelIds) {
      const oldest = lastSeenByChannel.get(channelId) ?? '0'
      const response = await client.conversations.history({
        channel: channelId,
        oldest,
        inclusive: false,
        limit: 15,
      })

      const messages = ((response.messages ?? []) as SlackMessage[])
        .filter((message) => isPlainUserMessage(message) && message.user !== botUserId)
        .sort((left, right) => compareTs(left.ts, right.ts))

      if (messages.length === 0) {
        continue
      }

      for (const message of messages) {
        await queueApproval(message, channelId)
      }

      lastSeenByChannel.set(channelId, getNewestTs(messages, oldest))
    }
  }

  async function pollApprovalDecisions(): Promise<void> {
    const channel = await ensureOwnerDmChannelId()
    const response = await client.conversations.history({
      channel,
      limit: 100,
    })

    const messages = new Map(
      ((response.messages ?? []) as SlackMessage[]).map((message) => [message.ts, message]),
    )

    for (const pending of [...pendingApprovals.values()]) {
      const approvalMessage = messages.get(pending.approvalMessageTs)
      const isApproved = hasReactionFromUser(
        approvalMessage,
        ['+1', 'thumbsup', 'white_check_mark'],
        config.ownerUserId,
      )
      const isRejected = hasReactionFromUser(
        approvalMessage,
        ['-1', 'thumbsdown', 'x'],
        config.ownerUserId,
      )

      if (!isApproved && !isRejected) {
        continue
      }

      pendingApprovals.delete(pending.approvalMessageTs)

      if (isRejected && !isApproved) {
        continue
      }

      await client.chat.postMessage({
        channel: pending.sourceChannelId,
        thread_ts: pending.sourceThreadTs,
        text: pending.replyText,
      })
    }
  }

  async function seedState(): Promise<void> {
    for (const channelId of config.watchedChannelIds) {
      lastSeenByChannel.set(channelId, await getLatestMessageTs(channelId))
    }

    await ensureOwnerDmChannelId()
  }

  async function runPollCycle(): Promise<void> {
    if (pollInFlight) {
      console.warn('Skipping poll cycle because the previous cycle is still running.')
      return
    }

    pollInFlight = true
    try {
      await pollWatchedChannels()
      await pollApprovalDecisions()
    } catch (error) {
      console.error('Poll cycle failed:', error)
    } finally {
      pollInFlight = false
    }
  }

  await seedState()

  console.log(
    `Slack polling bot is running for ${config.ownerUserId} in ${teamName}. Watching: ${[
      ...config.watchedChannelIds,
    ].join(
      ', ',
    )}. Polling every ${config.pollIntervalMs}ms. Auto-approve: ${config.allwaysApprove}.`,
  )

  await runPollCycle()
  setInterval(() => {
    void runPollCycle()
  }, config.pollIntervalMs)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
