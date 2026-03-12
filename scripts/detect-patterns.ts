#!/usr/bin/env npx tsx
/**
 * CLI wrapper for the pattern detector.
 *
 * Usage:
 *   npm run detect-patterns
 *   npm run detect-patterns -- --model google/gemini-2.5-flash-preview
 *   npm run detect-patterns -- --days 2       (analyze 2 days ago instead of yesterday)
 *   npm run detect-patterns -- --date 2026-03-07  (analyze a specific calendar day)
 */

import { config as loadEnv } from 'dotenv'
loadEnv()

import * as fs from 'fs'
import { StorageService } from '../src/main/storage/index'
import { getDefaultDbPath } from '../src/main/paths'
import { PatternDetector } from '../src/main/services/pattern-detector'
import { PATTERN_DETECTION_CONFIG } from '../src/shared/constants'

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2)
  let dbPath = getDefaultDbPath()
  let model = PATTERN_DETECTION_CONFIG.MODEL
  let apiKey = process.env.OPENROUTER_API_KEY || ''
  let days = PATTERN_DETECTION_CONFIG.LOOKBACK_DAYS

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

  const targetDay = new Date()
  targetDay.setDate(targetDay.getDate() - days)
  const dateLabel = targetDay.toISOString().slice(0, 10)

  console.log('=== Pattern Detector ===')
  console.log(`Database: ${dbPath}`)
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
      apiKey,
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
