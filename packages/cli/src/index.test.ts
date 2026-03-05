import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import log from '@main/logger'
import { StorageService } from '@main/storage'
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

const TEST_DB_PATH = path.join(process.cwd(), 'temp_cli_test.db')

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

    // Seed a pattern + sighting
    storage.patterns.addPattern({
      id: 'pat-1',
      name: 'Code Review',
      description: 'Reviewing PRs on GitHub',
      apps: ['Chrome'],
      automationIdea: 'Auto-merge simple PRs',
      createdAt: 1000,
    })
    storage.patterns.addSighting({
      id: 'sight-1',
      patternId: 'pat-1',
      detectedAt: 2000,
      runId: 'run-abc',
      evidence: 'Saw PR review',
      activityIds: ['act-3'],
      confidence: 0.9,
    })
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
    it('should return all patterns', async () => {
      const result = (await cmdPatterns([], storage)) as Array<Record<string, unknown>>
      expect(result.length).toBe(1)
      expect(result[0].name).toBe('Code Review')
      expect(result[0].sightingCount).toBe(1)
    })

    it('should search patterns by --query', async () => {
      const result = (await cmdPatterns(['--query', 'Review'], storage)) as Array<
        Record<string, unknown>
      >
      expect(result.length).toBe(1)
    })

    it('should return empty for non-matching query', async () => {
      const result = (await cmdPatterns(['--query', 'zzzzz'], storage)) as unknown[]
      expect(result.length).toBe(0)
    })
  })

  // -- pattern --

  describe('cmdPattern', () => {
    it('should return pattern by id', async () => {
      const result = (await cmdPattern(['pat-1'], storage)) as Record<string, unknown>
      const pattern = result.pattern as Record<string, unknown>
      expect(pattern.id).toBe('pat-1')
      expect(pattern.name).toBe('Code Review')
    })

    it('should include sightings when --run-id is given', async () => {
      const result = (await cmdPattern(['pat-1', '--run-id', 'run-abc'], storage)) as Record<
        string,
        unknown
      >
      expect(result.pattern).toBeDefined()
      const sightings = result.sightings as Array<Record<string, unknown>>
      expect(sightings.length).toBe(1)
      expect(sightings[0].evidence).toBe('Saw PR review')
    })

    it('should return empty sightings for unknown run-id', async () => {
      const result = (await cmdPattern(['pat-1', '--run-id', 'run-xxx'], storage)) as Record<
        string,
        unknown
      >
      expect((result.sightings as unknown[]).length).toBe(0)
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
