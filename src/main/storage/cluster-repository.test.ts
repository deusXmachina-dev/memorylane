import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { StorageService } from './index'
import { applyMigrations } from './migrator'
import { deleteDbFiles, v } from './test-utils'
import type { Cluster } from './cluster-repository'
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
  activeMin: overrides.activeMin ?? 5,
  runId: overrides.runId ?? 'run-1',
  detectedAt: overrides.detectedAt ?? 2000,
})

const createCluster = (overrides: Partial<Cluster> & { id: string }): Cluster => ({
  id: overrides.id,
  label: overrides.label ?? '',
  description: overrides.description ?? '',
  centroid: overrides.centroid ?? null,
  mechanism: overrides.mechanism ?? '',
  steps: overrides.steps ?? [],
  variables: overrides.variables ?? [],
  labeledSize: overrides.labeledSize ?? 0,
  createdAt: overrides.createdAt ?? 1000,
})

describe('ClusterRepository', () => {
  const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_cluster_repo_test.db')
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

  it('round-trips signature embeddings and treats NULL as processed', () => {
    storage.sightings.add(createSighting({ id: 's1' }))
    storage.sightings.add(createSighting({ id: 's2' }))
    storage.sightings.add(createSighting({ id: 's3' }))

    storage.clusters.upsertSignature('s1', v(0.6, 0.8))
    storage.clusters.upsertSignature('s2', null)

    expect(storage.clusters.getUnprocessedSightings().map((s) => s.id)).toEqual(['s3'])

    storage.clusters.create(createCluster({ id: 'c1' }))
    storage.clusters.addMembership('c1', 's1')
    storage.clusters.addMembership('c1', 's2')

    // Only the non-null signature comes back.
    const sigs = storage.clusters.getSignaturesByClusterId('c1')
    expect([...sigs.keys()]).toEqual(['s1'])
    expect(sigs.get('s1')![0]).toBeCloseTo(0.6)
    expect(sigs.get('s1')![1]).toBeCloseTo(0.8)
  })

  it('round-trips cluster centroids', () => {
    storage.clusters.create(createCluster({ id: 'c1', centroid: v(1) }))
    const cluster = storage.clusters.getById('c1')!
    expect(cluster.centroid![0]).toBeCloseTo(1)
    expect(cluster.centroid).toHaveLength(384)

    storage.clusters.updateCentroid('c1', v(0, 1))
    expect(storage.clusters.getById('c1')!.centroid![1]).toBeCloseTo(1)
  })

  it('getRecurringLabels returns labeled clusters with 2+ members', () => {
    storage.sightings.add(createSighting({ id: 's1' }))
    storage.sightings.add(createSighting({ id: 's2' }))
    storage.sightings.add(createSighting({ id: 's3' }))
    storage.clusters.create(createCluster({ id: 'recurring', label: 'Weekly report' }))
    storage.clusters.addMembership('recurring', 's1')
    storage.clusters.addMembership('recurring', 's2')
    storage.clusters.create(createCluster({ id: 'single', label: 'One-off' }))
    storage.clusters.addMembership('single', 's3')
    storage.clusters.create(createCluster({ id: 'unlabeled' }))

    expect(storage.clusters.getRecurringLabels()).toEqual([
      { label: 'Weekly report', timesSeen: 2 },
    ])
  })

  it('getMemberDigest returns per-member rows across clusters', () => {
    storage.sightings.add(
      createSighting({ id: 's1', startedAt: 1000, endedAt: 2000, activeMin: 4, apps: ['A'] }),
    )
    storage.sightings.add(
      createSighting({
        id: 's2',
        startedAt: 5000,
        endedAt: 9000,
        activeMin: 8,
        apps: ['A', 'B'],
      }),
    )
    storage.clusters.create(createCluster({ id: 'c1' }))
    storage.clusters.addMembership('c1', 's1')
    storage.clusters.addMembership('c1', 's2')

    const digest = storage.clusters.getMemberDigest()
    expect(digest.map((d) => d.activeMin)).toEqual([4, 8])
    expect(digest.map((d) => d.clusterId)).toEqual(['c1', 'c1'])
  })

  it('getMemberDigest returns member steps, tolerating corrupt JSON', () => {
    storage.sightings.add(
      createSighting({ id: 's1', startedAt: 1000, steps: ['TestApp: do the thing'] }),
    )
    storage.sightings.add(createSighting({ id: 's2', startedAt: 2000 }))
    storage.getDatabase().prepare(`UPDATE sightings SET steps = 'not json' WHERE id = 's2'`).run()
    storage.clusters.create(createCluster({ id: 'c1' }))
    storage.clusters.addMembership('c1', 's1')
    storage.clusters.addMembership('c1', 's2')

    const digest = storage.clusters.getMemberDigest()
    expect(digest.map((d) => d.steps)).toEqual([['TestApp: do the thing'], []])
  })

  it('updateLabel with null mechanism keeps the stored judgment', () => {
    storage.clusters.create(createCluster({ id: 'c1', label: 'Old', mechanism: 'A script' }))

    storage.clusters.updateLabel('c1', 'New', 'desc', null, 3)
    expect(storage.clusters.getById('c1')!.mechanism).toBe('A script')

    storage.clusters.updateLabel('c1', 'Newer', 'desc', '', 3)
    expect(storage.clusters.getById('c1')!.mechanism).toBe('')
  })

  it('moves memberships between clusters', () => {
    storage.sightings.add(createSighting({ id: 's1' }))
    storage.sightings.add(createSighting({ id: 's2' }))
    storage.clusters.create(createCluster({ id: 'from' }))
    storage.clusters.create(createCluster({ id: 'to' }))
    storage.clusters.addMembership('from', 's1')
    storage.clusters.addMembership('to', 's2')

    expect(storage.clusters.moveMemberships('from', 'to')).toBe(1)
    expect(storage.clusters.getMemberCount('to')).toBe(2)
    expect(storage.clusters.getMemberCount('from')).toBe(0)
  })

  it('pruneOrphans drops rows for deleted sightings and empties clusters', () => {
    storage.sightings.add(createSighting({ id: 'stays', startedAt: Date.now() }))
    storage.sightings.add(createSighting({ id: 'goes1', startedAt: 0 }))
    storage.sightings.add(createSighting({ id: 'goes2', startedAt: 0 }))
    storage.clusters.upsertSignature('stays', v(1))
    storage.clusters.upsertSignature('goes1', v(0, 1))

    storage.clusters.create(createCluster({ id: 'mixed' }))
    storage.clusters.addMembership('mixed', 'stays')
    storage.clusters.addMembership('mixed', 'goes1')
    storage.clusters.create(createCluster({ id: 'doomed' }))
    storage.clusters.addMembership('doomed', 'goes2')

    storage.sightings.pruneOlderThan(90)

    const result = storage.clusters.pruneOrphans()
    expect(result.droppedMemberships).toBe(2)
    expect(result.droppedSignatures).toBe(1)
    expect(result.deletedClusters).toBe(1)
    // 'doomed' was deleted, so only 'mixed' needs a centroid refresh.
    expect(result.touchedClusterIds).toEqual(['mixed'])

    expect(storage.clusters.getById('doomed')).toBeNull()
    expect(storage.clusters.getMembers('mixed').map((s) => s.id)).toEqual(['stays'])
  })

  it('delete removes the cluster and its memberships but not sightings', () => {
    storage.sightings.add(createSighting({ id: 's1' }))
    storage.clusters.create(createCluster({ id: 'c1' }))
    storage.clusters.addMembership('c1', 's1')

    storage.clusters.delete('c1')
    expect(storage.clusters.getById('c1')).toBeNull()
    expect(storage.clusters.getMemberCount('c1')).toBe(0)
    expect(storage.sightings.getById('s1')).not.toBeNull()
  })
})
