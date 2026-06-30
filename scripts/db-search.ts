#!/usr/bin/env npx tsx
/**
 * CLI tool to search the MemoryLane database.
 *
 * Usage:
 *   npm run db:search "your search query"
 *   npm run db:search "your search query" --limit 10
 *   npm run db:search "your search query" --db-path /custom/path --include-ocr
 */

import * as fs from 'fs'
import { StorageService } from '../src/main/storage'
import { EmbeddingService } from '../src/main/processor/embedding'
import { getDefaultDbPath } from '../src/main/utils/paths'

interface CLIArgs {
  query: string
  limit: number
  dbPath: string
  includeOcr: boolean
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2)

  let query = ''
  let limit = 5
  let dbPath = getDefaultDbPath()
  let includeOcr = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10)
      i++
    } else if (arg === '--db-path' && args[i + 1]) {
      dbPath = args[i + 1]
      i++
    } else if (arg === '--include-ocr') {
      includeOcr = true
    } else if (!arg.startsWith('--')) {
      query = arg
    }
  }

  return { query, limit, dbPath, includeOcr }
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString()
}

function truncateText(text: string, maxLength = 200): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

async function main() {
  const { query, limit, dbPath, includeOcr } = parseArgs()

  if (!query) {
    console.error(
      'Usage: npm run db:search "your search query" [--limit N] [--db-path PATH] [--include-ocr]',
    )
    console.error('')
    console.error('Options:')
    console.error('  --limit N        Number of results to return (default: 5)')
    console.error('  --db-path PATH   Path to SQLite database file')
    console.error('  --include-ocr    Include OCR text in output (default: false)')
    console.error('')
    console.error(`Default database path: ${getDefaultDbPath()}`)
    process.exit(1)
  }

  // Check if database exists
  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found at: ${dbPath}`)
    console.error('')
    console.error('Make sure the MemoryLane app has run and captured some data.')
    console.error('Or specify a custom path with --db-path')
    process.exit(1)
  }

  console.log(`Searching: "${query}"`)
  console.log(`Database: ${dbPath}`)
  console.log(`Limit: ${limit}`)
  console.log(`Include OCR: ${includeOcr}`)
  console.log('---')

  try {
    // Initialize services
    const storage = new StorageService(dbPath)

    const embeddingService = new EmbeddingService()
    await embeddingService.init()

    // Generate query embedding
    console.log('Generating embedding...')
    const queryVector = await embeddingService.generateEmbedding(query)

    // Run both searches
    console.log('Searching...')
    const vectorResults = storage.activities.searchVectors(queryVector, limit)
    const ftsResults = storage.activities.searchFTS(query, limit)

    // Display vector search results
    console.log('\n=== Vector Search Results ===\n')
    if (vectorResults.length === 0) {
      console.log('No results found.')
    } else {
      vectorResults.forEach((result, index) => {
        console.log(`[${index + 1}] ${formatTimestamp(result.startTimestamp)}`)
        console.log(`    ID: ${result.id}`)
        console.log(`    App: ${result.appName}`)
        console.log(`    Summary: ${truncateText(result.summary)}`)
        console.log('')
      })
    }

    // Display FTS results
    console.log('=== Full-Text Search Results ===\n')
    if (ftsResults.length === 0) {
      console.log('No results found.')
    } else {
      ftsResults.forEach((result, index) => {
        console.log(`[${index + 1}] ${formatTimestamp(result.startTimestamp)}`)
        console.log(`    ID: ${result.id}`)
        console.log(`    App: ${result.appName}`)
        console.log(`    Summary: ${truncateText(result.summary)}`)
        console.log('')
      })
    }

    // Summary
    console.log('---')
    console.log(`Vector results: ${vectorResults.length}, FTS results: ${ftsResults.length}`)

    storage.close()
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
