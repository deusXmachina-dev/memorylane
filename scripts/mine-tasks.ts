#!/usr/bin/env npx tsx
/**
 * CLI wrapper for the task miner.
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
 * Mines grounded sightings for a day.
 *
 * Usage:
 *   npm run mine-tasks
 *   npm run mine-tasks -- --model qwen3.5:9b   (override settings model)
 *   npm run mine-tasks -- --days 2             (analyze 2 days ago instead of yesterday)
 *   npm run mine-tasks -- --date 2026-03-07    (analyze a specific calendar day)
 *   npm run mine-tasks -- --api-key <key>      (override env var)
 *   npm run mine-tasks -- --user-data <path>   (point at a non-default userData dir)
 *   npm run mine-tasks -- --two-phase          (re-enable Phase 2 grounding calls;
 *                                               scan-only/one-shot is the default)
 *   npm run mine-tasks -- --no-clustering      (skip the post-mining clustering pass)
 */

import { config as loadEnv } from 'dotenv'
loadEnv()

import * as fs from 'fs'
import { StorageService } from '../src/main/storage/index'
import { applyMigrations } from '../src/main/storage/migrator'
import { getDefaultDbPath } from '../src/main/utils/paths'
import { TaskMiner, DEFAULT_MINER_CONFIG } from '../src/main/services/task-miner'
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
  scanOnly: boolean
  clustering: boolean
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  let dbPath = getDefaultDbPath()
  let modelOverride: string | null = null
  let apiKey: string | undefined
  let userDataPath: string | undefined
  let vendorOverride: string | undefined
  let days = PATTERN_DETECTION_CONFIG.LOOKBACK_DAYS
  let scanOnly = DEFAULT_MINER_CONFIG.scanOnly
  let clustering = DEFAULT_MINER_CONFIG.clustering

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
      if (isNaN(days) || days < 0) {
        console.error(`Invalid --days: ${args[i + 1]} (use a non-negative integer)`)
        process.exit(1)
      }
      i++
    } else if (args[i] === '--scan-only') {
      scanOnly = true
    } else if (args[i] === '--two-phase') {
      scanOnly = false
    } else if (args[i] === '--no-clustering') {
      clustering = false
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

  return { dbPath, modelOverride, apiKey, userDataPath, vendorOverride, days, scanOnly, clustering }
}

async function main() {
  const {
    dbPath,
    modelOverride,
    apiKey,
    userDataPath,
    vendorOverride,
    days,
    scanOnly,
    clustering,
  } = parseArgs()

  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found at: ${dbPath}`)
    process.exit(1)
  }

  const handle = loadCliInferenceProvider({ apiKey, userDataPath, vendorOverride })
  const model = modelOverride || handle.patternDetectionModel || DEFAULT_MINER_CONFIG.model

  const targetDay = new Date()
  targetDay.setDate(targetDay.getDate() - days)
  const dateLabel = targetDay.toISOString().slice(0, 10)

  console.log('=== Task Miner ===')
  console.log(`Database: ${dbPath}`)
  console.log(`Vendor:   ${handle.vendor}${handle.baseURL ? ` (${handle.baseURL})` : ''}`)
  console.log(`Model:    ${model}`)
  console.log(`Date:     ${dateLabel} (${days} days ago)`)
  console.log('')

  const storageService = new StorageService(dbPath)
  // The clustering pass writes to tables the app may not have created yet
  // (it migrates on startup); migrations are idempotent.
  applyMigrations(storageService.getDatabase())

  const count = storageService.activities.count()
  console.log(`Activities in DB: ${count}`)

  if (count === 0) {
    console.log('No activities to analyze.')
    storageService.close()
    return
  }

  try {
    const miner = new TaskMiner(storageService)
    const result = await miner.run(
      handle.provider,
      {
        model,
        lookbackDays: days,
        scanOnly,
        clustering,
      },
      (msg) => {
        console.log(`  ${msg}`)
      },
    )

    console.log('\n=== RESULTS ===')
    console.log(`Run ID:           ${result.runId}`)
    console.log(
      `Candidates:       ${result.candidatesFromScan} scanned → ${result.candidatesKept} kept, ${result.candidatesRejected} rejected`,
    )
    console.log(`Sightings mined:  ${result.sightingsFound}`)
    console.log(
      `Tokens (scan):    ${result.tokenUsage.scan.input} in / ${result.tokenUsage.scan.output} out`,
    )
    console.log(
      `Tokens (verify):  ${result.tokenUsage.verify.input} in / ${result.tokenUsage.verify.output} out`,
    )
    console.log(
      `Tokens (total):   ${result.tokenUsage.total.input} in / ${result.tokenUsage.total.output} out`,
    )

    // Print the sightings mined in this run, with their computed windows.
    const mined = storageService.sightings.getByRunId(result.runId)
    if (mined.length > 0) {
      console.log(`\n=== Sightings this run (${mined.length}) ===`)
      for (const s of mined) {
        const spanMin = Math.round((s.endedAt - s.startedAt) / 60000)
        console.log(`\n  ${s.title}`)
        console.log(`    Apps: ${s.apps.join(', ')}`)
        console.log(
          `    ${s.interactionMin} min interaction / ${spanMin} min span | ${s.activityIds.length} activities`,
        )
        console.log(
          `    ${new Date(s.startedAt).toISOString()} → ${new Date(s.endedAt).toISOString()}`,
        )
      }
    }

    if (result.clustering) {
      const c = result.clustering
      console.log('\n=== Clustering ===')
      console.log(`New signatures:   ${c.newSignatures} (${c.unclustered} without usable vectors)`)
      console.log(`Attached:         ${c.attached} to existing clusters`)
      console.log(`New clusters:     ${c.newClusters}`)
      console.log(`Review:           ${c.labeled} labeled, ${c.merged} merged, ${c.split} split`)
      console.log(`Tokens (review):  ${c.tokenUsage.input} in / ${c.tokenUsage.output} out`)
      if (c.llmError) console.log(`Review error:     ${c.llmError}`)

      const clusters = storageService.clusters.getAllWithStats()
      if (clusters.length > 0) {
        console.log(`\n=== Clusters (${clusters.length}) ===`)
        for (const cl of clusters) {
          // Unlabeled clusters fall back to the most common member title.
          const label = cl.label || mostCommonTitle(storageService.clusters.getMembers(cl.id))
          console.log(`\n  ${label}${cl.label ? '' : ' [unlabeled]'}`)
          if (cl.description) console.log(`    ${cl.description}`)
          console.log(
            `    Seen ${cl.timesSeen}x | avg ${cl.avgInteractionMin.toFixed(1)} min interaction` +
              (cl.lastSeenAt
                ? ` | last ${new Date(cl.lastSeenAt).toISOString().slice(0, 10)}`
                : ''),
          )
          if (cl.apps.length > 0) console.log(`    Apps: ${cl.apps.join(', ')}`)
        }
      }
    }
  } finally {
    storageService.close()
  }
}

function mostCommonTitle(sightings: { title: string }[]): string {
  const counts = new Map<string, number>()
  for (const s of sightings) counts.set(s.title, (counts.get(s.title) ?? 0) + 1)
  let best = '(unlabeled)'
  let bestCount = 0
  for (const [title, count] of counts) {
    if (count > bestCount) {
      best = title
      bestCount = count
    }
  }
  return best
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
