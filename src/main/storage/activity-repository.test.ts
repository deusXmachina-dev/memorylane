import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { StorageService } from './index'
import * as path from 'path'
import { v, deleteDbFiles, createStoredActivity } from './test-utils'

describe('ActivityRepository', () => {
  const TEST_DB_PATH = path.join(process.cwd(), 'temp_repo_test.db')
  let storage: StorageService

  beforeEach(() => {
    deleteDbFiles(TEST_DB_PATH)
    storage = new StorageService(TEST_DB_PATH)
  })

  afterEach(() => {
    storage.close()
    deleteDbFiles(TEST_DB_PATH)
  })

  it('should add and retrieve an activity with all fields', () => {
    const activity = createStoredActivity({
      id: 'uuid-1',
      startTimestamp: 1000,
      endTimestamp: 5000,
      appName: 'VS Code',
      summary: 'Editing TypeScript',
      ocrText: 'function hello()',
      vector: v(0.1, 0.2, 0.3),
    })

    storage.activities.add(activity)

    const retrieved = storage.activities.getByIds(['uuid-1'])
    expect(retrieved.length).toBe(1)
    expect(retrieved[0].summary).toBe('Editing TypeScript')
    expect(retrieved[0].appName).toBe('VS Code')
    expect(retrieved[0].ocrText).toBe('function hello()')
    expect(retrieved[0].vector.length).toBe(384)
    expect(retrieved[0].vector[0]).toBeCloseTo(0.1)
  })

  describe('searchFTS', () => {
    it('should return matching results ranked by relevance', () => {
      storage.activities.add(
        createStoredActivity({
          id: 'fts-1',
          summary: 'Editing TypeScript handler',
          ocrText: 'function handleRequest()',
        }),
      )
      storage.activities.add(
        createStoredActivity({
          id: 'fts-2',
          summary: 'Reading documentation',
          ocrText: 'TypeScript handbook page',
        }),
      )

      const results = storage.activities.searchFTS('TypeScript', 10)

      expect(results.length).toBe(2)
      const ids = results.map((r) => r.id)
      expect(ids).toContain('fts-1')
      expect(ids).toContain('fts-2')
    })

    it('should return empty array when table is empty', () => {
      const results = storage.activities.searchFTS('nonexistent', 10)
      expect(results).toEqual([])
    })

    it('should handle special characters in query without throwing', () => {
      storage.activities.add(
        createStoredActivity({ id: 'fts-special', summary: 'Testing quotes "hello"' }),
      )

      const results = storage.activities.searchFTS('"hello" world', 10)
      expect(results.length).toBeGreaterThanOrEqual(0)
    })

    it('should filter by appName', () => {
      storage.activities.add(
        createStoredActivity({
          id: 'fts-vs',
          appName: 'VS Code',
          summary: 'TypeScript editing',
        }),
      )
      storage.activities.add(
        createStoredActivity({
          id: 'fts-chrome',
          appName: 'Chrome',
          summary: 'TypeScript docs',
        }),
      )

      const results = storage.activities.searchFTS('TypeScript', 10, {
        appName: 'VS Code',
      })

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('fts-vs')
    })

    it('should filter by time range', () => {
      storage.activities.add(
        createStoredActivity({
          id: 'fts-old',
          startTimestamp: 1000,
          endTimestamp: 2000,
          summary: 'TypeScript early',
        }),
      )
      storage.activities.add(
        createStoredActivity({
          id: 'fts-new',
          startTimestamp: 5000,
          endTimestamp: 6000,
          summary: 'TypeScript later',
        }),
      )

      const results = storage.activities.searchFTS('TypeScript', 10, {
        startTime: 3000,
      })

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('fts-new')
    })

    it('should return lightweight ActivitySummary without ocrText or vector', () => {
      storage.activities.add(
        createStoredActivity({
          id: 'fts-light',
          windowTitle: 'Feature Request.md',
          summary: 'Lightweight check',
          ocrText: 'should not appear',
        }),
      )

      const results = storage.activities.searchFTS('Lightweight', 10)

      expect(results.length).toBe(1)
      expect(results[0]).toHaveProperty('id')
      expect(results[0].windowTitle).toBe('Feature Request.md')
      expect(results[0]).toHaveProperty('summary')
      expect(results[0]).not.toHaveProperty('ocrText')
      expect(results[0]).not.toHaveProperty('vector')
    })
  })

  describe('searchVectors', () => {
    it('should return results ordered by similarity', () => {
      storage.activities.add(
        createStoredActivity({ id: 'vec-1', vector: v(1.0), summary: 'First' }),
      )
      storage.activities.add(
        createStoredActivity({ id: 'vec-2', vector: v(0.9, 0.1), summary: 'Second' }),
      )
      storage.activities.add(
        createStoredActivity({ id: 'vec-3', vector: v(0.0, 1.0), summary: 'Third' }),
      )

      const results = storage.activities.searchVectors(v(1.0), 10)

      expect(results.length).toBe(3)
      expect(results[0].id).toBe('vec-1')
    })

    it('should return empty array on empty table', () => {
      const results = storage.activities.searchVectors(v(1.0), 10)
      expect(results).toEqual([])
    })

    it('should filter by appName', () => {
      storage.activities.add(
        createStoredActivity({
          id: 'vec-vs',
          appName: 'VS Code',
          vector: v(1.0),
        }),
      )
      storage.activities.add(
        createStoredActivity({
          id: 'vec-chrome',
          appName: 'Chrome',
          vector: v(0.9, 0.1),
        }),
      )

      const results = storage.activities.searchVectors(v(1.0), 10, {
        appName: 'VS Code',
      })

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('vec-vs')
    })

    it('should filter by time range', () => {
      storage.activities.add(
        createStoredActivity({
          id: 'vec-old',
          startTimestamp: 1000,
          endTimestamp: 2000,
          vector: v(1.0),
        }),
      )
      storage.activities.add(
        createStoredActivity({
          id: 'vec-new',
          startTimestamp: 5000,
          endTimestamp: 6000,
          vector: v(0.9, 0.1),
        }),
      )

      const results = storage.activities.searchVectors(v(1.0), 10, {
        startTime: 3000,
      })

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('vec-new')
    })

    it('should handle combined filters (appName + time)', () => {
      storage.activities.add(
        createStoredActivity({
          id: 'combo-1',
          startTimestamp: 1000,
          endTimestamp: 1500,
          appName: 'VS Code',
          vector: v(1.0),
        }),
      )
      storage.activities.add(
        createStoredActivity({
          id: 'combo-2',
          startTimestamp: 3000,
          endTimestamp: 3500,
          appName: 'VS Code',
          vector: v(0.9, 0.1),
        }),
      )
      storage.activities.add(
        createStoredActivity({
          id: 'combo-3',
          startTimestamp: 3000,
          endTimestamp: 3500,
          appName: 'Chrome',
          vector: v(0.8, 0.2),
        }),
      )

      const results = storage.activities.searchVectors(v(1.0), 10, {
        appName: 'VS Code',
        startTime: 2000,
      })

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('combo-2')
    })

    it('should respect limit with filters', () => {
      for (let i = 0; i < 5; i++) {
        storage.activities.add(
          createStoredActivity({
            id: `limit-${i}`,
            appName: 'VS Code',
            vector: v(1.0 - i * 0.1, i * 0.1),
          }),
        )
      }

      const results = storage.activities.searchVectors(v(1.0), 2, {
        appName: 'VS Code',
      })

      expect(results.length).toBe(2)
    })

    it('should return lightweight ActivitySummary without ocrText or vector', () => {
      storage.activities.add(
        createStoredActivity({
          id: 'vec-light',
          windowTitle: 'src/main/mcp/tools.ts',
          vector: v(1.0),
          ocrText: 'should not appear',
        }),
      )

      const results = storage.activities.searchVectors(v(1.0), 10)

      expect(results.length).toBe(1)
      expect(results[0]).toHaveProperty('id')
      expect(results[0].windowTitle).toBe('src/main/mcp/tools.ts')
      expect(results[0]).toHaveProperty('summary')
      expect(results[0]).not.toHaveProperty('ocrText')
      expect(results[0]).not.toHaveProperty('vector')
    })

    it('should handle appName case-insensitively', () => {
      storage.activities.add(
        createStoredActivity({
          id: 'case-1',
          appName: 'VS Code',
          vector: v(1.0),
        }),
      )

      const results = storage.activities.searchVectors(v(1.0), 10, {
        appName: 'vs code',
      })

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('case-1')
    })
  })

  describe('getByTimeRange', () => {
    it('should return activities sorted by start_timestamp', () => {
      storage.activities.add(
        createStoredActivity({ id: 'time-2', startTimestamp: 2000, appName: 'Chrome' }),
      )
      storage.activities.add(
        createStoredActivity({ id: 'time-1', startTimestamp: 1000, appName: 'VS Code' }),
      )

      const results = storage.activities.getByTimeRange(null, null)

      expect(results.length).toBe(2)
      expect(results[0].id).toBe('time-1')
      expect(results[1].id).toBe('time-2')
    })

    it('should filter by time range', () => {
      storage.activities.add(
        createStoredActivity({ id: 'range-1', startTimestamp: 1000, endTimestamp: 1400 }),
      )
      storage.activities.add(
        createStoredActivity({ id: 'range-2', startTimestamp: 2000, endTimestamp: 2400 }),
      )
      storage.activities.add(
        createStoredActivity({ id: 'range-3', startTimestamp: 3000, endTimestamp: 3400 }),
      )

      const results = storage.activities.getByTimeRange(1500, 2500)

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('range-2')
    })

    it('should filter with only startTime', () => {
      storage.activities.add(
        createStoredActivity({ id: 'start-1', startTimestamp: 1000, endTimestamp: 1500 }),
      )
      storage.activities.add(
        createStoredActivity({ id: 'start-2', startTimestamp: 2000, endTimestamp: 2500 }),
      )
      storage.activities.add(
        createStoredActivity({ id: 'start-3', startTimestamp: 3000, endTimestamp: 3500 }),
      )

      const results = storage.activities.getByTimeRange(2000, null)

      expect(results.length).toBe(2)
      expect(results.find((r) => r.id === 'start-2')).toBeDefined()
      expect(results.find((r) => r.id === 'start-3')).toBeDefined()
    })

    it('should filter with only endTime', () => {
      storage.activities.add(
        createStoredActivity({ id: 'end-1', startTimestamp: 1000, endTimestamp: 1500 }),
      )
      storage.activities.add(
        createStoredActivity({ id: 'end-2', startTimestamp: 2000, endTimestamp: 2500 }),
      )
      storage.activities.add(
        createStoredActivity({ id: 'end-3', startTimestamp: 3000, endTimestamp: 3500 }),
      )

      const results = storage.activities.getByTimeRange(null, 2000)

      expect(results.length).toBe(2)
      expect(results.find((r) => r.id === 'end-1')).toBeDefined()
      expect(results.find((r) => r.id === 'end-2')).toBeDefined()
    })

    it('should filter by appName case-insensitively', () => {
      storage.activities.add(
        createStoredActivity({ id: 'app-1', appName: 'VS Code', startTimestamp: 1000 }),
      )
      storage.activities.add(
        createStoredActivity({ id: 'app-2', appName: 'Chrome', startTimestamp: 2000 }),
      )

      const results = storage.activities.getByTimeRange(null, null, { appName: 'vs code' })

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('app-1')
    })

    it('should return lightweight ActivitySummary without ocrText or vector', () => {
      storage.activities.add(
        createStoredActivity({
          id: 'light-1',
          startTimestamp: 1000,
          windowTitle: 'Q - KeePassXC',
          ocrText: 'should not appear',
        }),
      )

      const results = storage.activities.getByTimeRange(null, null)

      expect(results.length).toBe(1)
      expect(results[0]).toHaveProperty('id')
      expect(results[0].windowTitle).toBe('Q - KeePassXC')
      expect(results[0]).toHaveProperty('summary')
      expect(results[0]).not.toHaveProperty('ocrText')
      expect(results[0]).not.toHaveProperty('vector')
    })
  })

  describe('getDateRange', () => {
    it('should return correct oldest and newest timestamps', () => {
      storage.activities.add(
        createStoredActivity({ id: 'date-1', startTimestamp: 1000, endTimestamp: 3000 }),
      )
      storage.activities.add(
        createStoredActivity({ id: 'date-2', startTimestamp: 2000, endTimestamp: 5000 }),
      )

      const range = storage.activities.getDateRange()

      expect(range.oldest).toBe(1000)
      expect(range.newest).toBe(5000)
    })

    it('should return null values when table is empty', () => {
      const range = storage.activities.getDateRange()

      expect(range.oldest).toBeNull()
      expect(range.newest).toBeNull()
    })
  })

  describe('count', () => {
    it('should return correct count of activities', () => {
      expect(storage.activities.count()).toBe(0)

      storage.activities.add(createStoredActivity({ id: 'count-1' }))
      expect(storage.activities.count()).toBe(1)

      storage.activities.add(createStoredActivity({ id: 'count-2' }))
      expect(storage.activities.count()).toBe(2)
    })
  })

  describe('add edge cases', () => {
    it('should reject duplicate IDs with a PRIMARY KEY violation', () => {
      storage.activities.add(createStoredActivity({ id: 'dup-1' }))
      expect(() => storage.activities.add(createStoredActivity({ id: 'dup-1' }))).toThrow()
    })
  })

  describe('searchFTS additional', () => {
    it('should return results in BM25 ranking order', () => {
      // Activity with "TypeScript" in both summary AND ocrText should rank higher
      storage.activities.add(
        createStoredActivity({
          id: 'rank-low',
          summary: 'Reading documentation',
          ocrText: 'mentions TypeScript once',
        }),
      )
      storage.activities.add(
        createStoredActivity({
          id: 'rank-high',
          summary: 'TypeScript TypeScript TypeScript',
          ocrText: 'TypeScript handbook',
        }),
      )

      const results = storage.activities.searchFTS('TypeScript', 10)

      expect(results.length).toBe(2)
      expect(results[0].id).toBe('rank-high')
    })

    it('should return empty array for whitespace-only query', () => {
      storage.activities.add(createStoredActivity({ id: 'ws-1', summary: 'some text' }))

      const results = storage.activities.searchFTS('   ', 10)
      expect(results).toEqual([])
    })
  })

  describe('searchVectors additional', () => {
    it('should round-trip vector values through Float32 precision', () => {
      const original = v(0.123456789, -0.987654321, 0.5)
      storage.activities.add(createStoredActivity({ id: 'precision-1', vector: original }))

      const retrieved = storage.activities.getByIds(['precision-1'])
      expect(retrieved.length).toBe(1)
      expect(retrieved[0].vector.length).toBe(384)

      // Float32 has ~7 digits of precision
      for (let i = 0; i < 3; i++) {
        expect(retrieved[0].vector[i]).toBeCloseTo(original[i], 5)
      }
      // Remaining values should be 0
      for (let i = 3; i < 384; i++) {
        expect(retrieved[0].vector[i]).toBe(0)
      }
    })
  })

  describe('getByTimeRange additional', () => {
    it('should include activities that overlap the queried range', () => {
      // Activity spans 1900–2100, query range is 2000–2050
      storage.activities.add(
        createStoredActivity({ id: 'overlap-1', startTimestamp: 1900, endTimestamp: 2100 }),
      )

      const results = storage.activities.getByTimeRange(2000, 2050)

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('overlap-1')
    })

    it('should include activities at exact boundaries', () => {
      storage.activities.add(
        createStoredActivity({ id: 'boundary-1', startTimestamp: 1000, endTimestamp: 2000 }),
      )

      // startTime == endTimestamp: activity ends exactly at query start
      const atEnd = storage.activities.getByTimeRange(2000, 3000)
      expect(atEnd.length).toBe(1)

      // endTime == startTimestamp: activity starts exactly at query end
      const atStart = storage.activities.getByTimeRange(500, 1000)
      expect(atStart.length).toBe(1)
    })

    it('should return empty when startTime > endTime (no valid range)', () => {
      storage.activities.add(
        createStoredActivity({ id: 'inv-1', startTimestamp: 1000, endTimestamp: 2000 }),
      )

      const results = storage.activities.getByTimeRange(3000, 500)
      expect(results).toEqual([])
    })
  })

  describe('getByIds additional', () => {
    it('should return only found rows when mixing valid and non-existent IDs', () => {
      storage.activities.add(createStoredActivity({ id: 'exists-1' }))

      const results = storage.activities.getByIds(['exists-1', 'nope', 'also-nope'])
      expect(results.length).toBe(1)
      expect(results[0].id).toBe('exists-1')
    })

    it('should handle duplicate IDs in input', () => {
      storage.activities.add(createStoredActivity({ id: 'dup-input-1' }))

      const results = storage.activities.getByIds(['dup-input-1', 'dup-input-1'])
      // SQLite IN clause de-duplicates
      expect(results.length).toBe(1)
    })

    it('should return empty array for empty input', () => {
      const results = storage.activities.getByIds([])
      expect(results).toEqual([])
    })
  })

  describe('FTS triggers (update and delete)', () => {
    it('should reflect updated text in FTS search after UPDATE', () => {
      storage.activities.add(
        createStoredActivity({ id: 'trig-1', summary: 'original summary', ocrText: 'original' }),
      )

      // Verify original is searchable
      let results = storage.activities.searchFTS('original', 10)
      expect(results.length).toBe(1)

      // Directly update the activity row (StorageService doesn't expose update, use raw SQL)
      const db = new Database(TEST_DB_PATH)
      db.prepare(
        "UPDATE activities SET summary = 'updated summary', ocr_text = 'updated' WHERE id = 'trig-1'",
      ).run()
      db.close()

      // Old text should no longer match
      results = storage.activities.searchFTS('original', 10)
      expect(results.length).toBe(0)

      // New text should match
      results = storage.activities.searchFTS('updated', 10)
      expect(results.length).toBe(1)
      expect(results[0].id).toBe('trig-1')
    })

    it('should remove deleted rows from FTS index', () => {
      storage.activities.add(createStoredActivity({ id: 'trig-del', summary: 'deletable content' }))

      let results = storage.activities.searchFTS('deletable', 10)
      expect(results.length).toBe(1)

      // Directly delete
      const db = new Database(TEST_DB_PATH)
      db.prepare("DELETE FROM activities WHERE id = 'trig-del'").run()
      db.close()

      results = storage.activities.searchFTS('deletable', 10)
      expect(results.length).toBe(0)
    })
  })
})
