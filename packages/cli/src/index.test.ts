import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import log from '@main/utils/logger'
import { StorageService } from '@main/storage'
import { applyMigrations } from '@main/storage/migrator'
import { v, deleteDbFiles, createStoredActivity } from '@main/storage/test-utils'
import {
  CliError,
  parseFlags,
  parseGlobalArgs,
  parseTime,
  cmdStats,
  cmdSearch,
  cmdTimeline,
  cmdActivity,
  cmdPatterns,
  cmdPattern,
} from './index'

const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_cli_test.db')

// Silence electron-log output during tests
beforeAll(() => {
  const noop = (): void => {}
  log.debug = noop
  log.info = noop
  log.warn = noop
})

// ---------------------------------------------------------------------------
// parseFlags
// ---------------------------------------------------------------------------

describe('parseFlags', () => {
  it('should parse positional arguments', () => {
    const result = parseFlags(['hello', 'world'])
    expect(result.positional).toEqual(['hello', 'world'])
    expect(result.flags).toEqual({})
  })

  it('should parse flags with values', () => {
    const result = parseFlags(['--limit', '10', '--app', 'Chrome'])
    expect(result.flags).toEqual({ limit: '10', app: 'Chrome' })
    expect(result.positional).toEqual([])
  })

  it('should parse boolean flags', () => {
    const result = parseFlags(['--include-ocr', '--include-vector'])
    expect(result.flags).toEqual({ 'include-ocr': true, 'include-vector': true })
  })

  it('should handle mixed positional and flags', () => {
    const result = parseFlags(['query', '--limit', '5', '--include-ocr'])
    expect(result.positional).toEqual(['query'])
    expect(result.flags).toEqual({ limit: '5', 'include-ocr': true })
  })

  it('should treat flag at end without value as boolean', () => {
    const result = parseFlags(['--mode'])
    expect(result.flags).toEqual({ mode: true })
  })

  it('should handle empty args', () => {
    const result = parseFlags([])
    expect(result.positional).toEqual([])
    expect(result.flags).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// parseGlobalArgs
// ---------------------------------------------------------------------------

describe('parseGlobalArgs', () => {
  it('should extract command and rest', () => {
    const result = parseGlobalArgs(['node', 'cli.ts', 'stats'])
    expect(result.command).toBe('stats')
    expect(result.rest).toEqual([])
  })

  it('should pass remaining args as rest', () => {
    const result = parseGlobalArgs(['node', 'cli.ts', 'search', 'hello', '--limit', '3'])
    expect(result.command).toBe('search')
    expect(result.rest).toEqual(['hello', '--limit', '3'])
  })

  it('should extract --db-path from anywhere', () => {
    const result = parseGlobalArgs(['node', 'cli.ts', '--db-path', '/tmp/test.db', 'stats'])
    expect(result.dbPathFlag).toBe('/tmp/test.db')
    expect(result.command).toBe('stats')
    expect(result.rest).toEqual([])
  })

  it('should handle --db-path after command', () => {
    const result = parseGlobalArgs([
      'node',
      'cli.ts',
      'search',
      '--db-path',
      '/tmp/test.db',
      'query',
    ])
    expect(result.dbPathFlag).toBe('/tmp/test.db')
    expect(result.command).toBe('search')
    expect(result.rest).toEqual(['query'])
  })

  it('should return empty command for no args', () => {
    const result = parseGlobalArgs(['node', 'cli.ts'])
    expect(result.command).toBe('')
  })
})

// ---------------------------------------------------------------------------
// parseTime
// ---------------------------------------------------------------------------

describe('parseTime', () => {
  it('should return undefined for undefined input', () => {
    expect(parseTime(undefined, 'start')).toBeUndefined()
  })

  it('should return undefined for boolean true (bare flag)', () => {
    expect(parseTime(true, 'start')).toBeUndefined()
  })

  it('should parse "now"', () => {
    const before = Date.now()
    const result = parseTime('now', 'start')!
    const after = Date.now()
    expect(result).toBeGreaterThanOrEqual(before)
    expect(result).toBeLessThanOrEqual(after)
  })

  it('should parse ISO dates', () => {
    const result = parseTime('2024-01-15T12:00:00Z', 'start')
    expect(result).toBe(new Date('2024-01-15T12:00:00Z').getTime())
  })

  it('should throw CliError for invalid time', () => {
    expect(() => parseTime('not-a-time', 'start')).toThrow(CliError)
    expect(() => parseTime('not-a-time', 'start')).toThrow('Invalid time for --start')
  })
})

// ---------------------------------------------------------------------------
// Command handlers (against real in-memory-like test DB)
// ---------------------------------------------------------------------------

describe('command handlers', () => {
  let storage: StorageService

  beforeEach(() => {
    storage = new StorageService(TEST_DB_PATH)
    applyMigrations(storage.getDatabase())

    // Seed test data
    storage.activities.add(
      createStoredActivity({
        id: 'act-1',
        startTimestamp: 1000,
        endTimestamp: 2000,
        appName: 'Chrome',
        windowTitle: 'Google',
        summary: 'Searched for cats on Google',
        ocrText: 'cat pictures google search',
        vector: v(0.1, 0.2, 0.3),
      }),
    )
    storage.activities.add(
      createStoredActivity({
        id: 'act-2',
        startTimestamp: 3000,
        endTimestamp: 4000,
        appName: 'VSCode',
        windowTitle: 'index.ts',
        summary: 'Edited TypeScript code',
        ocrText: 'function main typescript',
        vector: v(0.4, 0.5, 0.6),
      }),
    )
    storage.activities.add(
      createStoredActivity({
        id: 'act-3',
        startTimestamp: 5000,
        endTimestamp: 6000,
        appName: 'Chrome',
        windowTitle: 'GitHub',
        summary: 'Reviewed pull request on GitHub',
        ocrText: 'pull request review github',
        vector: v(0.7, 0.8, 0.9),
      }),
    )

    // Seed a task cluster with two member sightings (recent, inside the stats window)
    const now = Date.now()
    const HOUR_MS = 60 * 60 * 1000
    storage.clusters.create({
      id: 'clu-1',
      label: 'Code Review',
      description: 'Reviewing PRs on GitHub',
      centroid: null,
      mechanism: 'Automate with gh CLI',
      steps: [],
      variables: [],
      labeledSize: 2,
      createdAt: now,
    })
    const sightings = [
      {
        id: 'clu-sight-old',
        title: 'Code Review',
        subject: 'PR 41',
        description: 'Reviewed a pull request',
        steps: [],
        apps: ['Chrome'],
        activityIds: ['act-1'],
        startedAt: now - 5 * HOUR_MS,
        endedAt: now - 4 * HOUR_MS,
        activeMin: 6,
        runId: 'run-1',
        detectedAt: now - 4 * HOUR_MS,
      },
      {
        id: 'clu-sight-new',
        title: 'Code Review',
        subject: 'PR 42',
        description: 'Reviewed a pull request',
        steps: [],
        apps: ['Chrome'],
        activityIds: ['act-3'],
        startedAt: now - 2 * HOUR_MS,
        endedAt: now - HOUR_MS,
        activeMin: 4,
        runId: 'run-1',
        detectedAt: now - HOUR_MS,
      },
    ]
    for (const s of sightings) {
      storage.sightings.add(s)
      storage.clusters.addMembership('clu-1', s.id)
    }
  })

  afterEach(() => {
    storage?.close()
    deleteDbFiles(TEST_DB_PATH)
  })

  // -- stats --

  describe('cmdStats', () => {
    it('should return db stats', async () => {
      const result = (await cmdStats(storage)) as Record<string, unknown>
      expect(result.activityCount).toBe(3)
      expect(result.patternCount).toBe(1)
      expect(result.dbSizeBytes).toBeGreaterThan(0)
      expect(result.dbPath).toBe(TEST_DB_PATH)

      const dateRange = result.dateRange as { oldest: number; newest: number }
      expect(dateRange.oldest).toBe(1000)
      expect(dateRange.newest).toBe(6000)
    })
  })

  // -- search --

  describe('cmdSearch', () => {
    it('should search FTS by default', async () => {
      const result = (await cmdSearch(['cats'], storage)) as Record<string, unknown>
      expect(result.query).toBe('cats')
      expect(result.mode).toBe('fts')
      expect(result.fts).toBeDefined()
      expect(result.vector).toBeUndefined()
    })

    it('should respect --limit', async () => {
      const result = (await cmdSearch(['code', '--limit', '1'], storage)) as Record<string, unknown>
      expect((result.fts as unknown[]).length).toBeLessThanOrEqual(1)
    })

    it('should filter by --app', async () => {
      const result = (await cmdSearch(['code', '--app', 'VSCode'], storage)) as Record<
        string,
        unknown
      >
      const fts = result.fts as Array<{ appName: string }>
      for (const r of fts) {
        expect(r.appName).toBe('VSCode')
      }
    })

    it('should throw on missing query', async () => {
      await expect(cmdSearch([], storage)).rejects.toThrow(CliError)
    })

    it('should throw on invalid --limit', async () => {
      await expect(cmdSearch(['cats', '--limit', 'abc'], storage)).rejects.toThrow(CliError)
    })

    it('should throw on invalid --mode', async () => {
      await expect(cmdSearch(['cats', '--mode', 'invalid'], storage)).rejects.toThrow(CliError)
    })
  })

  // -- timeline --

  describe('cmdTimeline', () => {
    it('should return all activities when no filters given', async () => {
      const result = (await cmdTimeline([], storage)) as Record<string, unknown>
      expect(result.totalCount).toBe(3)
      expect(result.returnedCount).toBe(3)
      expect((result.entries as unknown[]).length).toBe(3)
    })

    it('should filter by --start and --end', async () => {
      const result = (await cmdTimeline(
        ['--start', '1970-01-01T00:00:02Z', '--end', '1970-01-01T00:00:05Z'],
        storage,
      )) as Record<string, unknown>
      // Activities overlapping [2000ms, 5000ms]: act-1 ends@2000, act-2 [3000,4000], act-3 starts@5000
      expect(result.totalCount).toBeGreaterThanOrEqual(1)
    })

    it('should filter by --app', async () => {
      const result = (await cmdTimeline(['--app', 'Chrome'], storage)) as Record<string, unknown>
      const entries = result.entries as Array<{ appName: string }>
      expect(result.totalCount).toBe(2)
      for (const e of entries) {
        expect(e.appName).toBe('Chrome')
      }
    })

    it('should respect --limit with sampling', async () => {
      const result = (await cmdTimeline(['--limit', '1'], storage)) as Record<string, unknown>
      expect(result.returnedCount).toBe(1)
      expect(result.totalCount).toBe(3)
    })

    it('should throw on invalid --limit', async () => {
      await expect(cmdTimeline(['--limit', '0'], storage)).rejects.toThrow(CliError)
    })
  })

  // -- activity --

  describe('cmdActivity', () => {
    it('should return activities by id without ocr/vector by default', async () => {
      const result = (await cmdActivity(['act-1'], storage)) as Array<Record<string, unknown>>
      expect(result.length).toBe(1)
      expect(result[0].id).toBe('act-1')
      expect(result[0].ocrText).toBeUndefined()
      expect(result[0].vector).toBeUndefined()
    })

    it('should include ocr when --include-ocr is set', async () => {
      const result = (await cmdActivity(['act-1', '--include-ocr'], storage)) as Array<
        Record<string, unknown>
      >
      expect(result[0].ocrText).toBe('cat pictures google search')
      expect(result[0].vector).toBeUndefined()
    })

    it('should include vector when --include-vector is set', async () => {
      const result = (await cmdActivity(['act-1', '--include-vector'], storage)) as Array<
        Record<string, unknown>
      >
      expect(result[0].vector).toBeDefined()
      expect(result[0].ocrText).toBeUndefined()
    })

    it('should include both when both flags set', async () => {
      const result = (await cmdActivity(
        ['act-1', '--include-ocr', '--include-vector'],
        storage,
      )) as Array<Record<string, unknown>>
      expect(result[0].ocrText).toBeDefined()
      expect(result[0].vector).toBeDefined()
    })

    it('should return multiple activities', async () => {
      const result = (await cmdActivity(['act-1', 'act-2'], storage)) as Array<
        Record<string, unknown>
      >
      expect(result.length).toBe(2)
    })

    it('should return empty array for unknown ids', async () => {
      const result = (await cmdActivity(['nonexistent'], storage)) as unknown[]
      expect(result.length).toBe(0)
    })

    it('should throw on missing id', async () => {
      await expect(cmdActivity([], storage)).rejects.toThrow(CliError)
    })
  })

  // -- patterns --

  describe('cmdPatterns', () => {
    it('should return the clusters view', async () => {
      const result = (await cmdPatterns([], storage)) as Record<string, unknown>
      const clusters = result.clusters as Array<Record<string, unknown>>
      expect(clusters.length).toBe(1)
      expect(clusters[0].id).toBe('clu-1')
      expect(clusters[0].title).toBe('Code Review')
      expect(clusters[0].timesSeen).toBe(2)
      expect(result.hiddenCount).toBe(0)
    })

    it('should filter by --query case-insensitively', async () => {
      const result = (await cmdPatterns(['--query', 'GH CLI'], storage)) as Record<string, unknown>
      expect((result.clusters as unknown[]).length).toBe(1)
    })

    it('should return empty for non-matching query', async () => {
      const result = (await cmdPatterns(['--query', 'zzzzz'], storage)) as Record<string, unknown>
      expect((result.clusters as unknown[]).length).toBe(0)
    })

    it('should fail with the friendly hint when cluster tables are missing', async () => {
      const barePath = path.join(os.tmpdir(), 'temp_cli_unmigrated_test.db')
      deleteDbFiles(barePath)
      const bare = new StorageService(barePath)
      try {
        await expect(cmdPatterns([], bare)).rejects.toThrow('Task-mining tables not found')
      } finally {
        bare.close()
        deleteDbFiles(barePath)
      }
    })
  })

  // -- pattern --

  describe('cmdPattern', () => {
    it('should return pattern info with runs newest-first', async () => {
      const result = (await cmdPattern(['clu-1'], storage)) as Record<string, unknown>
      const pattern = result.pattern as Record<string, unknown>
      expect(pattern.id).toBe('clu-1')
      expect(pattern.title).toBe('Code Review')
      expect(pattern.timesSeen).toBe(2)
      const runs = result.runs as Array<Record<string, unknown>>
      expect(runs.map((r) => r.id)).toEqual(['clu-sight-new', 'clu-sight-old'])
    })

    it('should exclude runs outside the stats window', async () => {
      const staleStart = Date.now() - 100 * 24 * 60 * 60 * 1000
      storage.sightings.add({
        id: 'clu-sight-stale',
        title: 'Code Review',
        subject: 'PR 1',
        description: 'Reviewed a pull request',
        steps: [],
        apps: ['Chrome'],
        activityIds: ['act-1'],
        startedAt: staleStart,
        endedAt: staleStart + 60 * 60 * 1000,
        activeMin: 5,
        runId: 'run-0',
        detectedAt: staleStart,
      })
      storage.clusters.addMembership('clu-1', 'clu-sight-stale')

      const result = (await cmdPattern(['clu-1'], storage)) as Record<string, unknown>
      expect((result.pattern as Record<string, unknown>).timesSeen).toBe(2)
      const runs = result.runs as Array<Record<string, unknown>>
      expect(runs.map((r) => r.id)).toEqual(['clu-sight-new', 'clu-sight-old'])
    })

    it('should throw for unknown pattern id', async () => {
      await expect(cmdPattern(['nonexistent'], storage)).rejects.toThrow(CliError)
      await expect(cmdPattern(['nonexistent'], storage)).rejects.toThrow('Pattern not found')
    })

    it('should throw on missing id', async () => {
      await expect(cmdPattern([], storage)).rejects.toThrow(CliError)
    })
  })
})
