export type SlackReaction = {
  name: string
  users?: string[]
}

export type SlackMessage = {
  ts: string
  text?: string
  user?: string
  bot_id?: string
  subtype?: string
  thread_ts?: string
  reactions?: SlackReaction[]
}

export type PendingApproval = {
  sourceChannelId: string
  sourceThreadTs: string
  sourceUserId: string
  sourceText: string
  replyText: string
  approvalMessageTs: string
}

export type SlackRuntimeConfig = {
  enabled: boolean
  botToken: string | null
  ownerUserId: string
  watchedChannelIds: string[]
  pollIntervalMs: number
  allwaysApprove: boolean
}

export type SlackRuntimeState = {
  running: boolean
  lastError: string | null
}
