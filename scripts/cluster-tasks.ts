#!/usr/bin/env npx tsx
/**
 * CLI wrapper for the deterministic task clusterer.
 *
 * Groups mined sightings into recurring process candidates. No LLM, no API key
 * — safe to run and re-run as often as you like. Sightings are never modified;
 * the clusters + cluster_members tables are rebuilt idempotently each run.
 *
 * Usage:
 *   npm run cluster-tasks
 *   npm run cluster-tasks -- --db-path <path>
 *   npm run cluster-tasks -- --cos 0.85 --apps 0.4   (override thresholds)
 */

import * as fs from 'fs'
import { StorageService } from '../src/main/storage/index'
import { getDefaultDbPath } from '../src/main/paths'
import { runClustering } from '../src/main/services/task-clusterer'

interface CliArgs {
  dbPath: string
  cos: number | undefined
  apps: number | undefined
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  let dbPath = getDefaultDbPath()
  let cos: number | undefined
  let apps: number | undefined

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db-path' && args[i + 1]) {
      dbPath = args[i + 1]
      i++
    } else if (args[i] === '--cos' && args[i + 1]) {
      cos = parseFloat(args[i + 1])
      i++
    } else if (args[i] === '--apps' && args[i + 1]) {
      apps = parseFloat(args[i + 1])
      i++
    }
  }

  return { dbPath, cos, apps }
}

function main() {
  const { dbPath, cos, apps } = parseArgs()

  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found at: ${dbPath}`)
    process.exit(1)
  }

  console.log('=== Task Clusterer ===')
  console.log(`Database: ${dbPath}`)
  if (cos !== undefined) console.log(`cos threshold: ${cos}`)
  if (apps !== undefined) console.log(`apps threshold: ${apps}`)
  console.log('')

  const storage = new StorageService(dbPath)
  try {
    const result = runClustering(storage, { cosThreshold: cos, appThreshold: apps })

    console.log('=== RESULTS ===')
    console.log(`Run ID:        ${result.runId}`)
    console.log(`Sightings:     ${result.sightingsConsidered}`)
    console.log(`Clusters:      ${result.clustersFound}`)
    console.log(`Members:       ${result.membersAssigned}`)

    const clusters = storage.clusters.getClusters({ minDistinctDays: 1 })
    if (clusters.length > 0) {
      console.log(`\n=== Process candidates (${clusters.length}) ===`)
      for (const c of clusters) {
        const perWeek = c.perWeek != null ? `, ~${c.perWeek}×/week` : ''
        console.log(`\n  ${c.label}`)
        console.log(`    Apps: ${c.apps.join(', ')}`)
        console.log(
          `    Seen ${c.sightingCount}× over ${c.distinctDays} day(s)${perWeek} | ${Math.round(c.totalInteractionMin)} min total`,
        )
      }
    } else {
      console.log('\nNo recurring processes yet — need at least 2 similar sightings.')
    }
  } finally {
    storage.close()
  }
}

main()
