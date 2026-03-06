#!/usr/bin/env npx tsx

import { config as loadEnv } from 'dotenv'
loadEnv({ quiet: true })

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { buildAppDataPath } from '../src/main/paths'
import type { StorageService } from '../src/main/storage'
import type { ApiKeyManager } from '../src/main/settings/api-key-manager'

interface CLIArgs {
  query: string
  dbPath: string
  messageTs: string
  channelId: string
  senderUserId: string
  apiKey: string | null
  json: boolean
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2)
  let query = ''
  let dbPath = path.join(
    buildAppDataPath(process.platform, os.homedir(), process.env.APPDATA, false),
    'memorylane.db',
  )
  let messageTs = `${Date.now() / 1000}`
  let channelId = 'C_TEST'
  let senderUserId = 'U_TEST'
  let apiKey: string | null = null
  let json = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--db-path' && args[i + 1]) {
      dbPath = args[++i]
    } else if (arg === '--ts' && args[i + 1]) {
      messageTs = normalizeTsArg(args[++i])
    } else if (arg === '--channel' && args[i + 1]) {
      channelId = args[++i]
    } else if (arg === '--user' && args[i + 1]) {
      senderUserId = args[++i]
    } else if (arg === '--api-key' && args[i + 1]) {
      apiKey = args[++i]
    } else if (arg === '--json') {
      json = true
    } else if (!arg.startsWith('--') && query.length === 0) {
      query = arg
    }
  }

  return {
    query,
    dbPath,
    messageTs,
    channelId,
    senderUserId,
    apiKey,
    json,
  }
}

function normalizeTsArg(value: string): string {
  if (/^\d+\.\d+$/.test(value)) {
    return value
  }

  if (/^\d+$/.test(value)) {
    const numeric = Number.parseInt(value, 10)
    if (value.length >= 13) {
      return `${numeric / 1000}`
    }
    return `${numeric}`
  }

  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid --ts value: ${value}`)
  }
  return `${parsed / 1000}`
}

function printUsage(): void {
  console.error(
    'Usage: npm run slack:semantic:test -- "message text" [--ts ISO|slack_ts|ms] [--db-path PATH] [--channel C123] [--user U123] [--api-key KEY] [--json]',
  )
  console.error('')
  console.error('Defaults:')
  console.error(
    `  --db-path ${path.join(buildAppDataPath(process.platform, os.homedir(), process.env.APPDATA, false), 'memorylane.db')}`,
  )
  console.error(`  --ts now (${new Date().toISOString()})`)
}

async function main() {
  const args = parseArgs()

  if (!args.query) {
    printUsage()
    process.exit(1)
  }

  if (args.json) {
    process.env.MEMORYLANE_SILENT_LOGGER = '1'
  }

  if (!fs.existsSync(args.dbPath)) {
    console.error(`Database not found at: ${args.dbPath}`)
    process.exit(1)
  }

  const apiKey = await resolveApiKey(args.apiKey)
  const [{ StorageService }, { SlackSemanticLayer }] = await Promise.all([
    import('../src/main/storage'),
    import('../src/main/integrations/slack/semantic'),
  ])

  const storage: StorageService = new StorageService(args.dbPath)

  try {
    const layer = new SlackSemanticLayer({
      activities: storage.activities,
      apiKeyManager: {
        getApiKey: () => apiKey,
      } as ApiKeyManager,
    } satisfies ConstructorParameters<typeof SlackSemanticLayer>[0])

    const analysis = await layer.analyzeMessage({
      channelId: args.channelId,
      senderUserId: args.senderUserId,
      messageTs: args.messageTs,
      text: args.query,
    })

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            dbPath: args.dbPath,
            query: args.query,
            messageTs: args.messageTs,
            messageTimeIso: new Date(analysis.input.messageTimestampMs).toISOString(),
            ...analysis,
          },
          null,
          2,
        ),
      )
      return
    }

    console.log('=== Slack Semantic Test ===')
    console.log(`Database: ${args.dbPath}`)
    console.log(`Query:    ${args.query}`)
    console.log(`Time:     ${new Date(analysis.input.messageTimestampMs).toISOString()}`)
    console.log(`Client:   ${analysis.clientConfigured ? 'configured' : 'not configured'}`)

    if (analysis.relevanceDecision) {
      console.log('')
      console.log(`Relevance: ${analysis.relevanceDecision.kind}`)
      console.log(`Reason:    ${analysis.relevanceDecision.reason}`)
      if (analysis.relevanceDecision.notes) {
        console.log(`Notes:     ${analysis.relevanceDecision.notes}`)
      }
    }

    if (analysis.draftResult) {
      console.log('')
      console.log(`Draft stage: ${analysis.draftResult.kind}`)
      if (analysis.draftResult.kind === 'reply') {
        console.log(`Draft:       ${analysis.draftResult.text}`)
      } else {
        console.log(`Reason:      ${analysis.draftResult.reason}`)
      }
    }

    if (analysis.researchTrace && analysis.researchTrace.length > 0) {
      console.log('')
      console.log('Research trace:')
      for (const item of analysis.researchTrace) {
        console.log(`- ${item.toolName} ${JSON.stringify(item.arguments)} -> ${item.resultSummary}`)
      }
    }

    console.log('')
    console.log(`Final result: ${analysis.proposal.kind} (${analysis.proposal.source})`)
    if (analysis.proposal.kind === 'reply') {
      console.log(`Reply:        ${analysis.proposal.text}`)
    } else {
      console.log(`Reason:       ${analysis.proposal.reason}`)
    }
  } finally {
    storage.close()
  }
}

async function resolveApiKey(cliApiKey: string | null): Promise<string | null> {
  if (cliApiKey) {
    return cliApiKey
  }

  try {
    const { ApiKeyManager } = await import('../src/main/settings/api-key-manager')
    const manager: ApiKeyManager = new ApiKeyManager()
    return manager.getApiKey()
  } catch {
    return process.env.OPENROUTER_API_KEY ?? null
  }
}

main().catch((error) => {
  console.error('Fatal:', error instanceof Error ? error.message : error)
  process.exit(1)
})
