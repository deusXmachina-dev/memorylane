import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { StorageService } from '@main/storage'
import { applyMigrations } from '@main/storage/migrator'
import { deleteDbFiles, v } from '@main/storage/test-utils'
import type { Cluster } from '@main/storage/cluster-repository'
import type { Sighting } from '@main/storage/sighting-repository'
import { validateAndApply, mergePairKey, sanitizeVerdict, type ReviewGuards } from './apply-review'

const createSighting = (overrides: Partial<Sighting> & { id: string }): Sighting => ({
  id: overrides.id,
  title: overrides.title ?? 'Test sighting',
  description: overrides.description ?? '',
  apps: overrides.apps ?? [],
  activityIds: overrides.activityIds ?? [],
  startedAt: overrides.startedAt ?? 1000,
  endedAt: overrides.endedAt ?? 2000,
  interactionMin: overrides.interactionMin ?? 5,
  runId: overrides.runId ?? 'run-1',
  detectedAt: overrides.detectedAt ?? 2000,
})

const createCluster = (overrides: Partial<Cluster> & { id: string }): Cluster => ({
  id: overrides.id,
  label: overrides.label ?? '',
  description: overrides.description ?? '',
  centroid: overrides.centroid ?? null,
  kind: overrides.kind ?? '',
  mechanism: overrides.mechanism ?? '',
  labelModel: overrides.labelModel ?? '',
  labeledSize: overrides.labeledSize ?? 0,
  createdAt: overrides.createdAt ?? 1000,
  updatedAt: overrides.updatedAt ?? 1000,
})

describe('validateAndApply', () => {
  const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_apply_review_test.db')
  let storage: StorageService

  const seedCluster = (clusterId: string, createdAt: number, sightingIds: string[]) => {
    storage.clusters.create(createCluster({ id: clusterId, createdAt }))
    for (const id of sightingIds) {
      storage.sightings.add(createSighting({ id }))
      storage.clusters.upsertSignature(id, v(1), 100)
      storage.clusters.addMembership(clusterId, id, 100)
    }
  }

  const guards = (overrides: Partial<ReviewGuards> = {}): ReviewGuards => ({
    reviewableIds: overrides.reviewableIds ?? new Set(),
    newClusterIds: overrides.newClusterIds ?? new Set(),
    mergeCandidatePairs: overrides.mergeCandidatePairs ?? new Set(),
  })

  beforeEach(() => {
    deleteDbFiles(TEST_DB_PATH)
    storage = new StorageService(TEST_DB_PATH)
    applyMigrations(storage.getDatabase())
  })

  afterEach(() => {
    storage.close()
    deleteDbFiles(TEST_DB_PATH)
  })

  it('merges candidate pairs into the oldest cluster regardless of LLM order', () => {
    seedCluster('older', 100, ['s1'])
    seedCluster('newer', 200, ['s2'])

    const result = validateAndApply(
      storage,
      { merges: [{ merge: ['newer', 'older'], label: 'Merged process', description: 'Both.' }] },
      guards({
        reviewableIds: new Set(['older', 'newer']),
        mergeCandidatePairs: new Set([mergePairKey('older', 'newer')]),
      }),
      'test-model',
      5000,
    )

    expect(result.merged).toBe(1)
    expect(storage.clusters.getById('newer')).toBeNull()
    const survivor = storage.clusters.getById('older')!
    expect(survivor.label).toBe('Merged process')
    expect(survivor.labeledSize).toBe(2)
    expect(storage.clusters.getMemberCount('older')).toBe(2)
  })

  it('rejects merges that were not proposed as candidates', () => {
    seedCluster('a', 100, ['s1'])
    seedCluster('b', 200, ['s2'])

    const result = validateAndApply(
      storage,
      { merges: [{ merge: ['a', 'b'], label: 'Nope', description: '' }] },
      guards({ reviewableIds: new Set(['a', 'b']) }),
      'test-model',
      5000,
    )

    expect(result.merged).toBe(0)
    expect(storage.clusters.getById('a')).not.toBeNull()
    expect(storage.clusters.getById('b')).not.toBeNull()
  })

  it('accepts a chained merge connected through candidate pairs', () => {
    seedCluster('a', 100, ['s1'])
    seedCluster('b', 200, ['s2'])
    seedCluster('c', 300, ['s3'])

    const result = validateAndApply(
      storage,
      { merges: [{ merge: ['a', 'b', 'c'], label: 'Chain', description: '' }] },
      guards({
        reviewableIds: new Set(['a', 'b', 'c']),
        mergeCandidatePairs: new Set([mergePairKey('a', 'b'), mergePairKey('b', 'c')]),
      }),
      'test-model',
      5000,
    )

    expect(result.merged).toBe(2)
    expect(storage.clusters.getMemberCount('a')).toBe(3)
  })

  it('ignores hallucinated cluster ids', () => {
    seedCluster('real', 100, ['s1'])

    const result = validateAndApply(
      storage,
      {
        clusters: [{ id: 'ghost', label: 'Boo', description: '' }],
        merges: [{ merge: ['real', 'ghost'], label: 'No', description: '' }],
      },
      guards({ reviewableIds: new Set(['real']) }),
      'test-model',
      5000,
    )

    expect(result.merged).toBe(0)
    expect(result.labeled).toBe(0)
  })

  it('splits a new cluster, sending unassigned members to the largest group', () => {
    seedCluster('fresh', 100, ['s1', 's2', 's3', 's4'])

    const result = validateAndApply(
      storage,
      {
        clusters: [
          {
            id: 'fresh',
            split: [
              { label: 'Group A', description: 'a', sighting_ids: ['s1', 's2'] },
              { label: 'Group B', description: 'b', sighting_ids: ['s3'] },
            ],
          },
        ],
      },
      guards({ reviewableIds: new Set(['fresh']), newClusterIds: new Set(['fresh']) }),
      'test-model',
      5000,
    )

    expect(result.split).toBe(1)
    expect(storage.clusters.getById('fresh')).toBeNull()

    const clusters = storage.clusters.getAllWithStats()
    expect(clusters).toHaveLength(2)
    const groupA = clusters.find((c) => c.label === 'Group A')!
    const groupB = clusters.find((c) => c.label === 'Group B')!
    // s4 was unassigned → goes to the largest group (A).
    expect(
      storage.clusters
        .getMembers(groupA.id)
        .map((s) => s.id)
        .sort(),
    ).toEqual(['s1', 's2', 's4'])
    expect(storage.clusters.getMembers(groupB.id).map((s) => s.id)).toEqual(['s3'])
    expect(groupA.centroid).not.toBeNull()
  })

  it('refuses to split a pre-existing cluster', () => {
    seedCluster('stable', 100, ['s1', 's2'])

    const result = validateAndApply(
      storage,
      {
        clusters: [
          {
            id: 'stable',
            split: [
              { label: 'A', description: '', sighting_ids: ['s1'] },
              { label: 'B', description: '', sighting_ids: ['s2'] },
            ],
          },
        ],
      },
      guards({ reviewableIds: new Set(['stable']) }), // not in newClusterIds
      'test-model',
      5000,
    )

    expect(result.split).toBe(0)
    expect(storage.clusters.getById('stable')).not.toBeNull()
    expect(storage.clusters.getMemberCount('stable')).toBe(2)
  })

  it('applies labels with the member count as labeledSize', () => {
    seedCluster('c1', 100, ['s1', 's2', 's3'])

    const result = validateAndApply(
      storage,
      { clusters: [{ id: 'c1', label: 'Weekly invoicing', description: 'Sends invoices.' }] },
      guards({ reviewableIds: new Set(['c1']) }),
      'test-model',
      5000,
    )

    expect(result.labeled).toBe(1)
    const cluster = storage.clusters.getById('c1')!
    expect(cluster.label).toBe('Weekly invoicing')
    expect(cluster.labeledSize).toBe(3)
    expect(cluster.labelModel).toBe('test-model')
  })

  it('persists a sanitized verdict alongside the label', () => {
    seedCluster('c1', 100, ['s1', 's2'])

    validateAndApply(
      storage,
      {
        clusters: [
          {
            id: 'c1',
            label: 'Weekly invoicing',
            description: '',
            kind: 'procedure',
            mechanism: 'Sync the form tool to the invoicing tool.',
          },
        ],
      },
      guards({ reviewableIds: new Set(['c1']) }),
      'test-model',
      5000,
    )

    const cluster = storage.clusters.getById('c1')!
    expect(cluster.kind).toBe('procedure')
    expect(cluster.mechanism).toBe('Sync the form tool to the invoicing tool.')
  })

  it('does not wipe an existing verdict when a relabel omits the kind', () => {
    seedCluster('c1', 100, ['s1', 's2'])
    storage.clusters.updateVerdict('c1', { kind: 'procedure', mechanism: 'A script.' }, 200)

    validateAndApply(
      storage,
      { clusters: [{ id: 'c1', label: 'Renamed', description: '' }] },
      guards({ reviewableIds: new Set(['c1']) }),
      'test-model',
      5000,
    )

    const cluster = storage.clusters.getById('c1')!
    expect(cluster.label).toBe('Renamed')
    expect(cluster.kind).toBe('procedure')
    expect(cluster.mechanism).toBe('A script.')
  })
})

describe('sanitizeVerdict', () => {
  it('accepts a concrete procedure verdict', () => {
    expect(
      sanitizeVerdict({
        id: 'x',
        kind: 'procedure',
        mechanism: 'A script.',
      }),
    ).toEqual({ kind: 'procedure', mechanism: 'A script.' })
  })

  it('rejects a procedure without a concrete mechanism', () => {
    expect(sanitizeVerdict({ id: 'x', kind: 'procedure' })).toEqual({
      kind: '',
      mechanism: '',
    })
    expect(sanitizeVerdict({ id: 'x', kind: 'procedure', mechanism: '  ' })).toEqual({
      kind: '',
      mechanism: '',
    })
  })

  it('coerces off-enum values to the retry sentinel', () => {
    expect(sanitizeVerdict({ id: 'x', kind: 'busywork' })).toEqual({
      kind: '',
      mechanism: '',
    })
  })

  it('strips mechanisms from non-procedure kinds', () => {
    expect(sanitizeVerdict({ id: 'x', kind: 'monitoring', mechanism: 'A.' })).toEqual({
      kind: 'monitoring',
      mechanism: '',
    })
  })
})
