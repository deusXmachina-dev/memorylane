/**
 * CLI arg parser and dispatcher.
 *
 * Usage:
 *   memorylane search [query] [--start <time>] [--end <time>] [--app <name>] [--limit N] [--json] [--db <path>]
 *   memorylane timeline --start <time> --end <time> [--app <name>] [--limit N] [--sampling uniform|recent_first] [--json] [--db <path>]
 *   memorylane details <id...> [--json] [--db <path>]
 *
 * Note: EmbeddingService (which depends on the ESM-only @huggingface/transformers)
 * is loaded lazily via dynamic import() only when semantic search is needed.
 * This keeps all other commands working under CJS/tsx without ESM issues.
 */

import { Writable } from 'node:stream'
import { StorageService } from '../processor/storage'
import { getDefaultDbPath } from '../paths'
import { handleSearch, handleTimeline, handleDetails } from './commands'

const HELP = `\
memorylane — query your screen activity history

Usage:
  memorylane search [query] [options]     Semantic search over activity sessions
  memorylane timeline [options]           Browse activity over a time range
  memorylane details <id...> [options]    Get full activity details by ID
  memorylane help                         Show this help message

Global options:
  --db <path>        Path to the MemoryLane database file (default: auto-detected)
  --json             Output as JSON
  --help, -h         Show this help message

Search options:
  --start <time>     Only include results after this time (ISO 8601 or relative, e.g. "1 hour ago")
  --end <time>       Only include results before this time
  --app <name>       Filter by application name
  --limit <N>        Maximum number of results (default: 100)

Timeline options:
  --start <time>     Start of time range (required)
  --end <time>       End of time range (required)
  --app <name>       Filter by application name
  --limit <N>        Maximum number of results (default: 100)
  --sampling <mode>  "uniform" (default) or "recent_first"

Examples:
  memorylane search "PR review" --limit 10
  memorylane timeline --start "1 hour ago" --end now
  memorylane timeline --start yesterday --end now --app "VS Code" --json
  memorylane details abc123 def456
  memorylane search --start "2 days ago" --end now --db ~/path/to/memorylane.db
`

interface ParsedArgs {
  command: string
  positionals: string[]
  db?: string
  start?: string
  end?: string
  app?: string
  limit?: number
  sampling?: string
  json: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = []
  let command = ''
  let db: string | undefined
  let start: string | undefined
  let end: string | undefined
  let app: string | undefined
  let limit: number | undefined
  let sampling: string | undefined
  let json = false

  let i = 0

  // First positional is the command
  if (i < argv.length && !argv[i].startsWith('--')) {
    command = argv[i]
    i++
  }

  while (i < argv.length) {
    const arg = argv[i]

    if (arg === '--db' && i + 1 < argv.length) {
      db = argv[++i]
    } else if (arg === '--start' && i + 1 < argv.length) {
      start = argv[++i]
    } else if (arg === '--end' && i + 1 < argv.length) {
      end = argv[++i]
    } else if (arg === '--app' && i + 1 < argv.length) {
      app = argv[++i]
    } else if (arg === '--limit' && i + 1 < argv.length) {
      const n = parseInt(argv[++i], 10)
      if (!isNaN(n) && n > 0) limit = n
    } else if (arg === '--sampling' && i + 1 < argv.length) {
      sampling = argv[++i]
    } else if (arg === '--json') {
      json = true
    } else if (arg === '--help' || arg === '-h') {
      command = 'help'
    } else if (!arg.startsWith('--')) {
      positionals.push(arg)
    } else {
      process.stderr.write(`Unknown option: ${arg}\n`)
    }

    i++
  }

  return { command, positionals, db, start, end, app, limit, sampling, json }
}

async function initStorage(dbPath?: string): Promise<StorageService> {
  const resolvedPath = dbPath || getDefaultDbPath()
  const storage = new StorageService(resolvedPath)
  await storage.init()
  return storage
}

/**
 * Lazily load the EmbeddingService to avoid pulling in @huggingface/transformers
 * (ESM-only) at module load time. Only needed for semantic search with a query.
 *
 * Returns null if the embedding module can't be loaded (e.g. ESM resolution
 * fails under tsx in dev mode). Callers fall back to FTS-only search.
 */
async function initEmbeddingService(): Promise<{
  generateEmbedding(text: string): Promise<number[]>
} | null> {
  try {
    const { EmbeddingService } = await import('../processor/embedding')
    const svc = new EmbeddingService()
    await svc.init()
    return svc
  } catch {
    process.stderr.write(
      'Warning: Embedding service unavailable (vector search disabled, using FTS only).\n',
    )
    return null
  }
}

/**
 * @param argv - Command-line arguments (after stripping the node/script path).
 * @param stdout - Writable stream for command output. Defaults to process.stdout
 *                 but callers can pass a captured real-stdout to avoid logger noise.
 */
export async function run(argv: string[], stdout?: Writable): Promise<number> {
  const out = stdout ?? process.stdout
  const args = parseArgs(argv)

  if (!args.command || args.command === 'help') {
    out.write(HELP)
    return 0
  }

  switch (args.command) {
    case 'search': {
      const storage = await initStorage(args.db)
      const needsEmbedding = !!args.positionals.join(' ').trim()
      const embeddingService = needsEmbedding ? await initEmbeddingService() : null
      return handleSearch(storage, embeddingService, out, {
        query: args.positionals.join(' ') || undefined,
        start: args.start,
        end: args.end,
        app: args.app,
        limit: args.limit,
        json: args.json,
      })
    }

    case 'timeline': {
      const storage = await initStorage(args.db)
      return handleTimeline(storage, out, {
        start: args.start,
        end: args.end,
        app: args.app,
        limit: args.limit,
        sampling: args.sampling as 'uniform' | 'recent_first' | undefined,
        json: args.json,
      })
    }

    case 'details': {
      if (args.positionals.length === 0) {
        process.stderr.write('Error: details requires at least one activity ID.\n')
        return 1
      }
      const storage = await initStorage(args.db)
      return handleDetails(storage, out, {
        ids: args.positionals,
        json: args.json,
      })
    }

    default:
      process.stderr.write(`Unknown command: ${args.command}\n\n`)
      out.write(HELP)
      return 1
  }
}
