// NODE_ENV=production and console.log→stderr redirect are injected
// by tsup banner (tsup.config.ts) so they run before any module init.

import { setLogger } from '@main/logger'

const noop = (): void => {}
setLogger({ debug: noop, info: noop })

import * as fs from 'fs'
import * as path from 'path'
import { StorageService } from '@main/storage'
import { getDefaultDbPath } from '@main/paths'
import { parseTimeString } from '@main/mcp/parse-time'
import { sampleEntries } from '@main/mcp/formatting'
import { resolveDbPath, setDbPath, getConfigFilePath } from './config'

// ---------------------------------------------------------------------------
// Error class for CLI validation failures
// ---------------------------------------------------------------------------

export class CliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliError'
  }
}

function fail(message: string): never {
  throw new CliError(message)
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  flags: Record<string, string | true>
  positional: string[]
}

export function parseFlags(args: string[]): ParsedArgs {
  const flags: Record<string, string | true> = {}
  const positional: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = args[i + 1]
      if (next && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positional.push(arg)
    }
  }

  return { flags, positional }
}

export function parseGlobalArgs(argv: string[]): {
  dbPathFlag: string | undefined
  command: string
  rest: string[]
} {
  const args = argv.slice(2)
  let dbPathFlag: string | undefined

  const filtered: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db-path' && args[i + 1]) {
      dbPathFlag = args[i + 1]
      i++
    } else {
      filtered.push(args[i])
    }
  }

  const command = filtered[0] ?? ''
  const rest = filtered.slice(1)
  return { dbPathFlag, command, rest }
}

export function parseTime(value: string | true | undefined, name: string): number | undefined {
  if (!value || value === true) return undefined
  const ts = parseTimeString(value)
  if (ts === null) fail(`Invalid time for --${name}: ${value}`)
  return ts
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

export async function cmdStats(storage: StorageService): Promise<unknown> {
  const count = storage.activities.count()
  const dateRange = storage.activities.getDateRange()
  const dbSize = storage.getDbSize()
  const patternCount = storage.patterns.patternCount()

  return {
    dbPath: storage.getDbPath(),
    dbSizeBytes: dbSize,
    activityCount: count,
    patternCount,
    dateRange: {
      oldest: dateRange.oldest,
      newest: dateRange.newest,
    },
  }
}

export async function cmdSearch(rest: string[], storage: StorageService): Promise<unknown> {
  const { flags, positional } = parseFlags(rest)
  const query = positional.join(' ')
  if (!query)
    fail(
      'Usage: search <query> [--limit N] [--start TIME] [--end TIME] [--app NAME] [--mode fts|vector|both]',
    )

  const limit = flags.limit ? parseInt(flags.limit as string, 10) : 5
  if (isNaN(limit) || limit < 1) fail('--limit must be a positive integer')

  const startTime = parseTime(flags.start, 'start')
  const endTime = parseTime(flags.end, 'end')
  const appName = flags.app as string | undefined
  const mode = (flags.mode as string) ?? 'fts'
  if (!['fts', 'vector', 'both'].includes(mode)) fail('--mode must be fts, vector, or both')

  const filters = { startTime, endTime, appName }
  const result: Record<string, unknown> = { query, mode }

  if (mode === 'fts' || mode === 'both') {
    result.fts = storage.activities.searchFTS(query, limit, filters)
  }

  if (mode === 'vector' || mode === 'both') {
    let EmbeddingService: typeof import('@main/processor/embedding').EmbeddingService
    try {
      const mod = await import('@main/processor/embedding')
      EmbeddingService = mod.EmbeddingService
    } catch {
      fail(
        'Vector search requires @huggingface/transformers. Install it with: npm install -g @huggingface/transformers',
      )
    }
    const embeddingService = new EmbeddingService()
    await embeddingService.init()
    const queryVector = await embeddingService.generateEmbedding(query)
    result.vector = storage.activities.searchVectors(queryVector, limit, filters)
  }

  return result
}

export async function cmdTimeline(rest: string[], storage: StorageService): Promise<unknown> {
  const { flags } = parseFlags(rest)

  const startTime = parseTime(flags.start, 'start') ?? null
  const endTime = parseTime(flags.end, 'end') ?? null
  const appName = flags.app as string | undefined
  const limit = flags.limit ? parseInt(flags.limit as string, 10) : 50
  if (isNaN(limit) || limit < 1) fail('--limit must be a positive integer')

  const entries = storage.activities.getByTimeRange(startTime, endTime, { appName })
  const sampled = sampleEntries(entries, limit, 'recent_first')

  return {
    totalCount: entries.length,
    returnedCount: sampled.length,
    entries: sampled,
  }
}

export async function cmdActivity(rest: string[], storage: StorageService): Promise<unknown> {
  const { flags, positional } = parseFlags(rest)
  if (positional.length === 0) fail('Usage: activity <id...> [--include-ocr] [--include-vector]')

  const includeOcr = flags['include-ocr'] === true
  const includeVector = flags['include-vector'] === true

  const activities = storage.activities.getByIds(positional)

  if (!includeOcr || !includeVector) {
    return activities.map((a) => {
      const { ocrText, vector, ...rest } = a
      const result: Record<string, unknown> = { ...rest }
      if (includeOcr) result.ocrText = ocrText
      if (includeVector) result.vector = vector
      return result
    })
  }
  return activities
}

export async function cmdPatterns(rest: string[], storage: StorageService): Promise<unknown> {
  const { flags } = parseFlags(rest)
  const query = flags.query as string | undefined

  if (query) {
    return storage.patterns.searchPatterns(query)
  }
  return storage.patterns.getAllPatterns()
}

export async function cmdPattern(rest: string[], storage: StorageService): Promise<unknown> {
  const { flags, positional } = parseFlags(rest)
  if (positional.length === 0) fail('Usage: pattern <id> [--run-id ID]')

  const id = positional[0]
  const pattern = storage.patterns.getPatternById(id)
  if (!pattern) fail(`Pattern not found: ${id}`)

  const runId = flags['run-id'] as string | undefined
  const result: Record<string, unknown> = { pattern }

  if (runId) {
    result.sightings = storage.patterns.getSightingsByRunId(runId)
  }

  return result
}

// ---------------------------------------------------------------------------
// set-db / get-db commands
// ---------------------------------------------------------------------------

function cmdSetDb(rest: string[]): void {
  const rawPath = rest[0]
  if (!rawPath) fail('Usage: set-db <path-to-database>')

  const resolved = path.resolve(rawPath)
  if (!fs.existsSync(resolved)) {
    fail(`Database file not found: ${resolved}`)
  }

  setDbPath(resolved)
  process.stdout.write(
    JSON.stringify({ ok: true, dbPath: resolved, configFile: getConfigFilePath() }) + '\n',
  )
}

function cmdGetDb(dbPathFlag: string | undefined): void {
  const { dbPath, source } = resolveDbPath(dbPathFlag, getDefaultDbPath)
  process.stdout.write(JSON.stringify({ dbPath, source }) + '\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const USAGE = `Usage: memorylane <command> [args]

Commands:
  stats                        Database statistics
  search <query>               Search activities (FTS, vector, or both)
  timeline                     List activities by time range
  activity <id...>             Get activity details by ID(s)
  patterns                     List detected patterns
  pattern <id>                 Get pattern details and sightings
  set-db <path>                Save database path to config
  get-db                       Show resolved database path

Global: --db-path <path>`

const DB_COMMANDS: Record<string, (rest: string[], storage: StorageService) => Promise<unknown>> = {
  stats: (_rest, storage) => cmdStats(storage),
  search: cmdSearch,
  timeline: cmdTimeline,
  activity: cmdActivity,
  patterns: cmdPatterns,
  pattern: cmdPattern,
}

async function main(): Promise<void> {
  const { dbPathFlag, command, rest } = parseGlobalArgs(process.argv)

  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(JSON.stringify({ error: USAGE }) + '\n')
    process.exit(1)
  }

  // Commands that don't need a database connection
  if (command === 'set-db') {
    cmdSetDb(rest)
    return
  }
  if (command === 'get-db') {
    cmdGetDb(dbPathFlag)
    return
  }

  const handler = DB_COMMANDS[command]
  if (!handler) {
    process.stdout.write(JSON.stringify({ error: `Unknown command: ${command}` }) + '\n')
    process.exit(1)
  }

  const { dbPath } = resolveDbPath(dbPathFlag, getDefaultDbPath)

  if (!fs.existsSync(dbPath)) {
    process.stdout.write(JSON.stringify({ error: `Database not found at: ${dbPath}` }) + '\n')
    process.exit(1)
  }

  const storage = new StorageService(dbPath)
  try {
    const result = await handler(rest, storage)
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  } catch (err) {
    if (err instanceof CliError) {
      process.stdout.write(JSON.stringify({ error: err.message }) + '\n')
      process.exit(1)
    }
    throw err
  } finally {
    storage.close()
  }
}

// Only run when executed directly (not when imported by tests)
if (require.main === module) {
  main().catch((err) => {
    process.stdout.write(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) + '\n',
    )
    process.exit(1)
  })
}
