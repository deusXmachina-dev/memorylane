import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { migration } from './0023_union_sighting_active_time'
import { StorageService } from '../index'
import { applyMigrations } from '../migrator'
import { createStoredActivity, deleteDbFiles } from '../test-utils'

const MIN = 60_000

describe('0023_union_sighting_active_time', () => {
  const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_migration_0023_test.db')
  let storage: StorageService

  const addActivity = (id: string, startMin: number, endMin: number): void => {
    storage.activities.add(
      createStoredActivity({ id, startTimestamp: startMin * MIN, endTimestamp: endMin * MIN }),
    )
  }

  const addSighting = (id: string, activityIds: string[], stored: number): void => {
    const bounds = storage.activities.getByIds(activityIds)
    storage.sightings.add({
      id,
      title: 'Test sighting',
      subject: '',
      description: 'Did the thing',
      steps: [],
      apps: ['TestApp'],
      activityIds,
      startedAt: bounds.length > 0 ? Math.min(...bounds.map((a) => a.startTimestamp)) : 0,
      endedAt: bounds.length > 0 ? Math.max(...bounds.map((a) => a.endTimestamp)) : 0,
      interactionMin: stored,
      runId: 'run-1',
      detectedAt: 0,
    })
  }

  // Read raw: the corrupt-JSON case below cannot go through rowToSighting.
  const activeMin = (id: string): number =>
    storage
      .getDatabase()
      .prepare<[string], { m: number }>(`SELECT interaction_min AS m FROM sightings WHERE id = ?`)
      .get(id)!.m

  const runMigration = (): void => migration.up(storage.getDatabase())

  beforeEach(() => {
    deleteDbFiles(TEST_DB_PATH)
    storage = new StorageService(TEST_DB_PATH)
    applyMigrations(storage.getDatabase())
  })

  afterEach(() => {
    storage.close()
    deleteDbFiles(TEST_DB_PATH)
  })

  it('excludes every gap, however short', () => {
    addActivity('a1', 0, 2)
    addActivity('a2', 4, 6) // 2-min gap — 0022 bridged this, 0023 does not
    addActivity('b1', 0, 2)
    addActivity('b2', 32, 34)
    addSighting('short-gap', ['a1', 'a2'], 6)
    addSighting('long-gap', ['b1', 'b2'], 4)

    runMigration()

    expect(activeMin('short-gap')).toBe(4)
    expect(activeMin('long-gap')).toBe(4)
  })

  it('counts adjacent activities as one continuous stretch', () => {
    addActivity('c1', 0, 5)
    addActivity('c2', 5, 10)
    addSighting('adjacent', ['c1', 'c2'], 10)

    runMigration()

    expect(activeMin('adjacent')).toBe(10)
  })

  it('does not double-count overlapping or nested activities', () => {
    addActivity('o1', 0, 10)
    addActivity('o2', 5, 15)
    addActivity('n1', 0, 30)
    addActivity('n2', 5, 6)
    addSighting('overlap', ['o1', 'o2'], 20)
    addSighting('nested', ['n1', 'n2'], 31)

    runMigration()

    expect(activeMin('overlap')).toBe(15)
    expect(activeMin('nested')).toBe(30)
  })

  it('never exceeds the wall-clock span', () => {
    addActivity('d1', 0, 5)
    addActivity('d2', 8, 20)
    addActivity('d3', 90, 95)
    addSighting('mixed', ['d1', 'd2', 'd3'], 25)

    runMigration()

    const s = storage.sightings.getById('mixed')!
    expect(s.interactionMin).toBe(22)
    expect(s.interactionMin).toBeLessThanOrEqual((s.endedAt - s.startedAt) / MIN)
  })

  it('leaves a sighting whose activities are only partly present untouched', () => {
    addActivity('p1', 0, 2)
    addSighting('partial', ['p1', 'missing-1'], 7.5)

    runMigration()

    expect(activeMin('partial')).toBe(7.5)
  })

  it('leaves a sighting citing no activities untouched', () => {
    addSighting('empty', [], 7.5)

    runMigration()

    expect(activeMin('empty')).toBe(7.5)
  })

  it('skips a sighting whose activity_ids is not valid JSON instead of failing the migration', () => {
    addActivity('v1', 0, 2)
    addActivity('v2', 4, 6)
    addSighting('valid', ['v1', 'v2'], 6)
    addSighting('broken', [], 3)
    storage
      .getDatabase()
      .prepare(`UPDATE sightings SET activity_ids = 'not json' WHERE id = 'broken'`)
      .run()

    expect(runMigration).not.toThrow()

    expect(activeMin('valid')).toBe(4)
    expect(activeMin('broken')).toBe(3)
  })
})
