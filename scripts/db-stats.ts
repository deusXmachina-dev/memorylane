#!/usr/bin/env npx tsx
/**
 * CLI tool to display MemoryLane database statistics.
 *
 * Usage:
 *   npm run db:stats
 *   npm run db:stats -- --db-path /custom/path
 */

import * as fs from 'fs'
import { StorageService } from '../src/main/storage'
import { getDefaultDbPath } from '../src/main/utils/paths'

interface CLIArgs {
  dbPath: string
}

function parseArgs(): CLIArgs {
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

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString()
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function getFileSize(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0
  return fs.statSync(filePath).size
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''}, ${hours % 24} hour${hours % 24 !== 1 ? 's' : ''}`
  }
  if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''}, ${minutes % 60} minute${minutes % 60 !== 1 ? 's' : ''}`
  }
  if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''}`
  }
  return `${seconds} second${seconds !== 1 ? 's' : ''}`
}

async function main() {
  const { dbPath } = parseArgs()

  console.log('=== MemoryLane Database Statistics ===\n')
  console.log(`Database path: ${dbPath}`)

  // Check if database exists
  if (!fs.existsSync(dbPath)) {
    console.log('\nDatabase not found.')
    console.log('Make sure the MemoryLane app has run and captured some data.')
    process.exit(1)
  }

  // Get disk size
  const diskSize = getFileSize(dbPath)
  console.log(`Database size: ${formatBytes(diskSize)}`)
  console.log('')

  try {
    // Initialize storage
    const storage = new StorageService(dbPath)

    // Get row count
    const count = storage.activities.count()
    console.log(`Total entries: ${count.toLocaleString()}`)

    if (count === 0) {
      console.log('\nNo entries in database yet.')
      storage.close()
      return
    }

    // Get date range
    const dateRange = storage.activities.getDateRange()

    if (dateRange.oldest && dateRange.newest) {
      console.log('')
      console.log('Date range:')
      console.log(`  Oldest: ${formatTimestamp(dateRange.oldest)}`)
      console.log(`  Newest: ${formatTimestamp(dateRange.newest)}`)

      const duration = dateRange.newest - dateRange.oldest
      console.log(`  Span:   ${formatDuration(duration)}`)

      // Calculate capture rate
      if (duration > 0) {
        const capturesPerHour = (count / (duration / (1000 * 60 * 60))).toFixed(1)
        console.log(`  Rate:   ~${capturesPerHour} captures/hour`)
      }
    }

    // Task-mining ledger
    const miningDays = storage.miningDays.getAll()
    if (miningDays.length > 0) {
      const counts = storage.miningDays.countByStatus()
      console.log('')
      console.log('Task mining:')
      console.log(
        `  Days:   ${counts.completed} completed, ${counts.pending} pending, ` +
          `${counts.running} running, ${counts.failed} failed`,
      )
      const lastCompleted = [...miningDays].reverse().find((d) => d.status === 'completed')
      if (lastCompleted) {
        console.log(`  Last completed: ${lastCompleted.day}`)
      }
      for (const d of miningDays.filter((day) => day.status === 'failed')) {
        console.log(`  FAILED ${d.day} (${d.attempts} attempts): ${d.lastError ?? 'unknown error'}`)
      }
    }

    storage.close()
  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
