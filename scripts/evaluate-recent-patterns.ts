#!/usr/bin/env npx tsx

import * as fs from 'fs'
import { StorageService } from '../src/main/storage'
import { getDefaultDbPath } from '../src/main/paths'
import {
  HeuristicRecentActivityPatternMatcher,
  evaluateRecentActivityPatternMatcher,
} from '../src/main/services/recent-activity-patterns'

function parseArgs(): { dbPath: string } {
  const args = process.argv.slice(2)
  let dbPath = getDefaultDbPath()

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db-path' && args[i + 1]) {
      dbPath = args[i + 1]
      i++
    }
  }

  return { dbPath }
}

async function main() {
  const { dbPath } = parseArgs()

  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found at: ${dbPath}`)
    process.exit(1)
  }

  const storage = new StorageService(dbPath)

  try {
    const evaluation = await evaluateRecentActivityPatternMatcher({
      patternRepository: storage.patterns,
      activityRepository: storage.activities,
      matcher: new HeuristicRecentActivityPatternMatcher(storage.activities),
    })

    console.log('=== Recent Activity Pattern Evaluation ===')
    console.log(`Database: ${dbPath}`)
    console.log(`Ground truth sightings: ${evaluation.groundTruthTimeline.length}`)
    console.log(`Predicted notifications: ${evaluation.predictedTimeline.length}`)
    console.log(`True positives: ${evaluation.metrics.truePositiveCount}`)
    console.log(`False negatives: ${evaluation.metrics.falseNegativeCount}`)
    console.log(`False positives: ${evaluation.metrics.falsePositiveCount}`)
    console.log(`Precision: ${formatMetric(evaluation.metrics.precision)}`)
    console.log(`Recall: ${formatMetric(evaluation.metrics.recall)}`)
    console.log(
      `Average detection delay: ${formatDuration(evaluation.metrics.averageDetectionDelayMs)}`,
    )

    if (evaluation.falseNegatives.length > 0) {
      console.log('\nMissed sightings:')
      for (const miss of evaluation.falseNegatives.slice(0, 20)) {
        console.log(
          `  ${miss.patternName} (${miss.patternId}) ${new Date(miss.startTimestamp).toISOString()} -> ${new Date(miss.endTimestamp).toISOString()}`,
        )
      }
    }

    if (evaluation.falsePositives.length > 0) {
      console.log('\nFalse positives:')
      for (const fp of evaluation.falsePositives.slice(0, 20)) {
        console.log(
          `  ${fp.patternName} (${fp.patternId}) at ${new Date(fp.notifiedAt).toISOString()}`,
        )
      }
    }
  } finally {
    storage.close()
  }
}

function formatMetric(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(3)
}

function formatDuration(value: number | null): string {
  return value === null ? 'n/a' : `${value}ms`
}

main().catch((error) => {
  console.error('Fatal:', error)
  process.exit(1)
})
