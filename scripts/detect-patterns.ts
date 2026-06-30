#!/usr/bin/env npx tsx
/**
 * CLI wrapper for the pattern detector.
 *
 * Reads the active vendor + per-vendor model selection from
 * capture-settings.json (same as the GUI) and routes through
 * InferenceProvider. The vendor's baseURL is read from
 * vendor-credentials.json. The api key must come from an env var
 * (OPENROUTER_API_KEY / GOOGLE_VERTEX_API_KEY / OPENAI_COMPATIBLE_API_KEY)
 * or `--api-key`, since the CLI cannot decrypt the encrypted blob without
 * an Electron app context. openai-compatible vendors that don't need a
 * key (e.g. Ollama) work as-is once the GUI has saved a baseURL.
 *
 * Usage:
 *   npm run detect-patterns
 *   npm run detect-patterns -- --model qwen3.5:9b   (override settings model)
 *   npm run detect-patterns -- --days 2             (analyze 2 days ago instead of yesterday)
 *   npm run detect-patterns -- --date 2026-03-07    (analyze a specific calendar day)
 *   npm run detect-patterns -- --api-key <key>      (override env var)
 *   npm run detect-patterns -- --user-data <path>   (point at a non-default userData dir)
 */

import { config as loadEnv } from 'dotenv'
loadEnv()

import * as fs from 'fs'
import { StorageService } from '../src/main/storage/index'
import { getDefaultDbPath } from '../src/main/utils/paths'
import { PatternDetector } from '../src/main/services/pattern-detector'
import { PATTERN_DETECTION_CONFIG } from '../src/shared/constants'
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
  let days = PATTERN_DETECTION_CONFIG.LOOKBACK_DAYS

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
    } else if (args[i] === '--date' && args[i + 1]) {
      const target = new Date(args[i + 1] + 'T00:00:00')
      if (isNaN(target.getTime())) {
        console.error(`Invalid date: ${args[i + 1]} (use YYYY-MM-DD)`)
        process.exit(1)
      }
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      days = Math.round((today.getTime() - target.getTime()) / (24 * 60 * 60 * 1000))
      if (days < 0) {
        console.error(`Date ${args[i + 1]} is in the future`)
        process.exit(1)
      }
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
  const model = modelOverride || handle.patternDetectionModel || PATTERN_DETECTION_CONFIG.MODEL

  const targetDay = new Date()
  targetDay.setDate(targetDay.getDate() - days)
  const dateLabel = targetDay.toISOString().slice(0, 10)

  console.log('=== Pattern Detector ===')
  console.log(`Database: ${dbPath}`)
  console.log(`Vendor:   ${handle.vendor}${handle.baseURL ? ` (${handle.baseURL})` : ''}`)
  console.log(`Model:    ${model}`)
  console.log(`Date:     ${dateLabel} (${days} days ago)`)
  console.log('')

  const storageService = new StorageService(dbPath)

  const count = storageService.activities.count()
  console.log(`Activities in DB: ${count}`)

  if (count === 0) {
    console.log('No activities to analyze.')
    storageService.close()
    return
  }

  try {
    const detector = new PatternDetector(storageService)
    const result = await detector.run(
      handle.provider,
      {
        model,
        lookbackDays: days,
      },
      (msg) => {
        console.log(`  ${msg}`)
      },
    )

    console.log('\n=== RESULTS ===')
    console.log(`Run ID:           ${result.runId}`)
    console.log(
      `Candidates:       ${result.candidatesFromScan} scanned → ${result.candidatesVerified} verified, ${result.candidatesRejected} rejected`,
    )
    console.log(`Total findings:   ${result.totalFindings}`)
    console.log(`New patterns:     ${result.newPatterns}`)
    console.log(`Updated patterns: ${result.updatedPatterns}`)
    console.log(
      `Tokens (scan):    ${result.tokenUsage.scan.input} in / ${result.tokenUsage.scan.output} out`,
    )
    console.log(
      `Tokens (verify):  ${result.tokenUsage.verify.input} in / ${result.tokenUsage.verify.output} out`,
    )
    console.log(
      `Tokens (total):   ${result.tokenUsage.total.input} in / ${result.tokenUsage.total.output} out`,
    )

    // Print active patterns
    const all = storageService.patterns.getAllPatterns()
    if (all.length > 0) {
      console.log(`\n=== Patterns (${all.length}) ===`)
      for (const p of all) {
        console.log(`\n  ${p.name} (${p.sightingCount} sighting(s))`)
        console.log(`    Apps: ${p.apps.join(', ')}`)
        console.log(`    Automation: ${p.automationIdea}`)
        if (p.lastSeenAt) {
          console.log(`    Last seen: ${new Date(p.lastSeenAt).toISOString()}`)
        }
      }
    }
  } finally {
    storageService.close()
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
