#!/usr/bin/env npx tsx
/**
 * CLI wrapper for the user context builder.
 *
 * Reads the active vendor from capture-settings.json (same as the GUI)
 * and routes through InferenceProvider. See `detect-patterns.ts` header
 * for the credentials story.
 *
 * The user-context model is currently hardcoded in
 * `USER_CONTEXT_CONFIG.MODEL` (tracked in DEU-83). For now, pass
 * `--model` explicitly when running against a non-OpenRouter vendor.
 *
 * Usage:
 *   npm run build-user-context
 *   npm run build-user-context -- --model qwen3.5:9b
 *   npm run build-user-context -- --days 14
 *   npm run build-user-context -- --api-key <key>
 *   npm run build-user-context -- --user-data <path>
 */

import { config as loadEnv } from 'dotenv'
loadEnv()

import * as fs from 'fs'
import { StorageService } from '../src/main/storage/index'
import { getDefaultDbPath } from '../src/main/paths'
import { UserContextBuilder } from '../src/main/services/user-context-builder'
import { USER_CONTEXT_CONFIG } from '../src/shared/constants'
import { loadCliInferenceProvider } from './cli-inference-provider'

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  dbPath: string
  modelOverride: string | null
  apiKey: string | undefined
  userDataPath: string | undefined
  vendorOverride: string | undefined
  days: number
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  let dbPath = getDefaultDbPath()
  let modelOverride: string | null = null
  let apiKey: string | undefined
  let userDataPath: string | undefined
  let vendorOverride: string | undefined
  let days = USER_CONTEXT_CONFIG.LOOKBACK_DAYS

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db-path' && args[i + 1]) {
      dbPath = args[i + 1]
      i++
    } else if (args[i] === '--model' && args[i + 1]) {
      modelOverride = args[i + 1]
      i++
    } else if (args[i] === '--api-key' && args[i + 1]) {
      apiKey = args[i + 1]
      i++
    } else if (args[i] === '--user-data' && args[i + 1]) {
      userDataPath = args[i + 1]
      i++
    } else if (args[i] === '--vendor' && args[i + 1]) {
      vendorOverride = args[i + 1]
      i++
    } else if (args[i] === '--days' && args[i + 1]) {
      days = parseInt(args[i + 1], 10)
      i++
    }
  }

  return { dbPath, modelOverride, apiKey, userDataPath, vendorOverride, days }
}

async function main() {
  const { dbPath, modelOverride, apiKey, userDataPath, vendorOverride, days } = parseArgs()

  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found at: ${dbPath}`)
    process.exit(1)
  }

  const handle = loadCliInferenceProvider({ apiKey, userDataPath, vendorOverride })
  // UserContextBuilder has no settings-driven model yet (DEU-83). Until
  // it does, prefer an explicit --model, otherwise fall back to the
  // hardcoded constant — which only works for OpenRouter.
  const model = modelOverride || USER_CONTEXT_CONFIG.MODEL

  console.log('=== User Context Builder ===')
  console.log(`Database: ${dbPath}`)
  console.log(`Vendor:   ${handle.vendor}${handle.baseURL ? ` (${handle.baseURL})` : ''}`)
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
    const result = await builder.run(handle.provider, { model, lookbackDays: days }, (msg) => {
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
