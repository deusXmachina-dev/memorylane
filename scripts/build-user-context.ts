#!/usr/bin/env npx tsx
/**
 * CLI wrapper for the user context builder.
 *
 * Usage:
 *   npm run build-user-context
 *   npm run build-user-context -- --model google/gemini-2.5-flash-preview
 *   npm run build-user-context -- --days 14
 */

import { config as loadEnv } from 'dotenv'
loadEnv()

import * as fs from 'fs'
import { StorageService } from '../src/main/storage/index'
import { getDefaultDbPath } from '../src/main/paths'
import { UserContextBuilder } from '../src/main/services/user-context-builder'
import { USER_CONTEXT_CONFIG } from '../src/shared/constants'

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2)
  let dbPath = getDefaultDbPath()
  let model = USER_CONTEXT_CONFIG.MODEL
  let apiKey = process.env.OPENROUTER_API_KEY || ''
  let days = USER_CONTEXT_CONFIG.LOOKBACK_DAYS

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db-path' && args[i + 1]) {
      dbPath = args[i + 1]
      i++
    } else if (args[i] === '--model' && args[i + 1]) {
      model = args[i + 1]
      i++
    } else if (args[i] === '--api-key' && args[i + 1]) {
      apiKey = args[i + 1]
      i++
    } else if (args[i] === '--days' && args[i + 1]) {
      days = parseInt(args[i + 1], 10)
      i++
    }
  }

  return { dbPath, model, apiKey, days }
}

async function main() {
  const { dbPath, model, apiKey, days } = parseArgs()

  if (!apiKey) {
    console.error('Error: No API key. Set OPENROUTER_API_KEY env var or use --api-key <key>')
    process.exit(1)
  }

  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found at: ${dbPath}`)
    process.exit(1)
  }

  console.log('=== User Context Builder ===')
  console.log(`Database: ${dbPath}`)
  console.log(`Model:    ${model}`)
  console.log(`Lookback: ${days} days`)
  console.log('')

  const storageService = new StorageService(dbPath)

  const count = storageService.activities.count()
  console.log(`Activities in DB: ${count}`)

  if (count === 0) {
    console.log('No activities to analyze.')
    storageService.close()
    return
  }

  // Show existing context if any
  const existing = storageService.userContext.get()
  if (existing) {
    console.log('\n=== Current Context ===')
    console.log(`Short:   ${existing.shortSummary}`)
    console.log(`Updated: ${new Date(existing.updatedAt).toISOString()}`)
    console.log(`Detail:\n${existing.detailedSummary}`)
  } else {
    console.log('\nNo existing user context (first run)')
  }

  console.log('\n--- Running update ---\n')

  try {
    const builder = new UserContextBuilder(storageService)
    const result = await builder.run(apiKey, { model, lookbackDays: days }, (msg) => {
      console.log(`  ${msg}`)
    })

    console.log('\n=== RESULT ===')
    console.log(`Short summary:    ${result.shortSummary}`)
    console.log(`Detailed summary:\n${result.detailedSummary}`)
    console.log(`Tokens:           ${result.tokenUsage.input} in / ${result.tokenUsage.output} out`)
  } finally {
    storageService.close()
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
