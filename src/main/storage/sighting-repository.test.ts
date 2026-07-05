import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { StorageService } from './index'
import { applyMigrations } from './migrator'
import { deleteDbFiles } from './test-utils'
import type { Sighting } from './sighting-repository'

const createSighting = (overrides: Partial<Sighting> & { id: string }): Sighting => ({
  id: overrides.id,
  title: overrides.title ?? 'Test sighting',
  description: overrides.description ?? 'Did the thing',
  apps: overrides.apps ?? ['TestApp'],
  activityIds: overrides.activityIds ?? ['act-1'],
  startedAt: overrides.startedAt ?? 1000,
  endedAt: overrides.endedAt ?? 2000,
  interactionMin: overrides.interactionMin ?? 5,
  runId: overrides.runId ?? 'run-1',
  detectedAt: overrides.detectedAt ?? 2000,
})

describe('SightingRepository', () => {
  const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_sighting_repo_test.db')
  let storage: StorageService

  beforeEach(() => {
    deleteDbFiles(TEST_DB_PATH)
    storage = new StorageService(TEST_DB_PATH)
    applyMigrations(storage.getDatabase())
  })

  afterEach(() => {
    storage.close()
    deleteDbFiles(TEST_DB_PATH)
  })

  describe('hasInWindow (backfill idempotency guard)', () => {
    it('is false for an empty window, true once a sighting starts inside it', () => {
      const start = 1_000_000
      const end = start + 86_400_000 - 1
      expect(storage.sightings.hasInWindow(start, end)).toBe(false)

      storage.sightings.add(createSighting({ id: 's1', startedAt: start + 5000 }))
      expect(storage.sightings.hasInWindow(start, end)).toBe(true)
    })

    it('treats both window boundaries as inclusive and excludes neighbours', () => {
      const start = 2_000_000
      const end = start + 999
      storage.sightings.add(createSighting({ id: 'lo', startedAt: start }))
      storage.sightings.add(createSighting({ id: 'hi', startedAt: end }))

      expect(storage.sightings.hasInWindow(start, end)).toBe(true)
      // A window ending just before the earliest sighting matches nothing.
      expect(storage.sightings.hasInWindow(start - 1000, start - 1)).toBe(false)
      // A window starting just after the latest sighting matches nothing.
      expect(storage.sightings.hasInWindow(end + 1, end + 1000)).toBe(false)
    })
  })
})
