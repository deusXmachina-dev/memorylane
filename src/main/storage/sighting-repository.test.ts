import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { StorageService } from './index'
import { applyMigrations } from './migrator'
import { deleteDbFiles, v } from './test-utils'
import type { Sighting } from './sighting-repository'

const createSighting = (overrides: Partial<Sighting> & { id: string }): Sighting => ({
  id: overrides.id,
  title: overrides.title ?? 'Test sighting',
  subject: overrides.subject ?? '',
  description: overrides.description ?? 'Did the thing',
  steps: overrides.steps ?? [],
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

  describe('steps', () => {
    it('round-trips steps through add/getById', () => {
      storage.sightings.add(
        createSighting({ id: 's1', steps: ['TestApp: open the export', 'notion.so: paste'] }),
      )
      expect(storage.sightings.getById('s1')?.steps).toEqual([
        'TestApp: open the export',
        'notion.so: paste',
      ])
    })

    it('reads [] from rows inserted without the steps column (pre-steps writers)', () => {
      storage
        .getDatabase()
        .prepare(
          `INSERT INTO sightings
             (id, title, subject, description, apps, activity_ids, started_at, ended_at, interaction_min, run_id, detected_at)
           VALUES ('legacy', 't', '', 'd', '[]', '[]', 1, 2, 1, 'r', 2)`,
        )
        .run()
      expect(storage.sightings.getById('legacy')?.steps).toEqual([])
    })
  })

  describe('subject', () => {
    it('round-trips subject through add/getById', () => {
      storage.sightings.add(
        createSighting({
          id: 's1',
          title: 'Provision test tenant',
          subject: 'Acme staging tenant',
        }),
      )
      expect(storage.sightings.getById('s1')?.subject).toBe('Acme staging tenant')
    })

    it('defaults subject to empty string', () => {
      storage.sightings.add(createSighting({ id: 's1' }))
      expect(storage.sightings.getById('s1')?.subject).toBe('')
    })

    it('search() matches on subject', () => {
      storage.sightings.add(
        createSighting({
          id: 's1',
          title: 'Provision test tenant',
          subject: 'Acme staging tenant',
        }),
      )
      const hits = storage.sightings.search('Acme')
      expect(hits.map((s) => s.id)).toContain('s1')
    })
  })

  describe('wipeTasks', () => {
    it('clears sightings, clusters, and the mining ledger; activities are untouched', () => {
      storage.activities.add({
        id: 'act-1',
        appName: 'TestApp',
        windowTitle: 'w',
        tld: null,
        startTimestamp: 1000,
        endTimestamp: 2000,
        summary: 's',
        summaryModel: '',
        ocrText: '',
        vector: v(0.1),
      })
      storage.sightings.add(createSighting({ id: 's1' }))
      storage.clusters.create({
        id: 'c1',
        label: 'Some process',
        description: '',
        centroid: null,
        kind: '',
        mechanism: '',
        steps: [],
        variables: [],
        labelModel: '',
        labeledSize: 0,
        createdAt: 1000,
        updatedAt: 1000,
      })
      storage.clusters.addMembership('c1', 's1', 100)
      storage.miningDays.enqueueMissing(['2026-07-01'], 1000)

      storage.wipeTasks()

      expect(storage.sightings.getById('s1')).toBeNull()
      expect(storage.clusters.getAll()).toHaveLength(0)
      expect(storage.miningDays.getAll()).toHaveLength(0)
      expect(storage.activities.count()).toBe(1)
    })
  })
})
