import { describe, it, expect, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { StorageService } from '../../storage'
import { applyMigrations } from '../../storage/migrator'
import { deleteDbFiles } from '../../storage/test-utils'
import type { Sighting } from '../../storage/sighting-repository'
import { runClustering } from './index'

const DB_PATH = path.join(os.tmpdir(), 'temp_clusterer_test.db')
const DAY = 86_400_000

function sighting(id: string, startedAt: number, interactionMin: number): Sighting {
  return {
    id,
    title: `task ${id}`,
    description: 'copy numbers from dashboard into the sheet',
    apps: ['Chrome', 'Sheets'],
    activityIds: [`act-${id}`],
    startedAt,
    endedAt: startedAt + interactionMin * 60_000,
    interactionMin,
    confidence: 0.8,
    runId: 'run-1',
    detectedAt: startedAt,
  }
}

describe('runClustering (storage integration)', () => {
  let storage: StorageService

  afterEach(() => {
    storage?.close()
    deleteDbFiles(DB_PATH)
  })

  it('groups similar same-app sightings, drops one-offs, and computes ROI stats', () => {
    storage = new StorageService(DB_PATH)
    applyMigrations(storage.getDatabase())

    const t0 = 1_700_000_000_000
    // Two near-identical sightings on different days → one process candidate.
    storage.sightings.add(sighting('a', t0, 5), [1, 0, 0, 0])
    storage.sightings.add(sighting('b', t0 + DAY, 7), [0.99, 0.01, 0, 0])
    // An unrelated one-off in a different app → singleton, must be dropped.
    const lone = sighting('c', t0 + 2 * DAY, 3)
    lone.apps = ['Slack']
    storage.sightings.add(lone, [0, 0, 1, 0])

    const result = runClustering(storage, { now: t0 + 3 * DAY })
    expect(result.sightingsConsidered).toBe(3)
    expect(result.clustersFound).toBe(1)
    expect(result.membersAssigned).toBe(2)

    const clusters = storage.clusters.getClusters()
    expect(clusters).toHaveLength(1)
    const c = clusters[0]
    expect(c.sightingCount).toBe(2)
    expect(c.distinctDays).toBe(2)
    expect(c.totalInteractionMin).toBe(12) // 5 + 7, measured — not extrapolated
    expect(c.apps.sort()).toEqual(['Chrome', 'Sheets'])

    // Detail resolves member sightings for the recall path.
    const detail = storage.clusters.getClusterDetail(c.id)
    expect(detail?.sightings.map((s) => s.id).sort()).toEqual(['a', 'b'])
  })

  it('rebuilds idempotently — re-running replaces, never duplicates', () => {
    storage = new StorageService(DB_PATH)
    applyMigrations(storage.getDatabase())
    const t0 = 1_700_000_000_000
    storage.sightings.add(sighting('a', t0, 5), [1, 0, 0, 0])
    storage.sightings.add(sighting('b', t0 + DAY, 7), [1, 0, 0, 0])

    runClustering(storage, { now: t0 + DAY })
    const first = storage.clusters.getClusters()
    runClustering(storage, { now: t0 + DAY })
    const second = storage.clusters.getClusters()

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    // Same membership both times.
    expect(storage.clusters.getClusterDetail(second[0].id)?.sightings).toHaveLength(2)
  })
})
