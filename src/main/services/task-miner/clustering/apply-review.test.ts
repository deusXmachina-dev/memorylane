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
  subject: overrides.subject ?? '',
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
  steps: overrides.steps ?? [],
  variables: overrides.variables ?? [],
  labelModel: overrides.labelModel ?? '',
  labeledSize: overrides.labeledSize ?? 0,
  createdAt: overrides.createdAt ?? 1000,
  updatedAt: overrides.updatedAt ?? 1000,
})

describe('validateAndApply', () => {
  const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_apply_review_test.db')
  let storage: StorageService

  const seedCluster = (
    clusterId: string,
    createdAt: number,
    sightingIds: string[],
    signature: (id: string) => number[] = () => v(1),
  ) => {
    storage.clusters.create(createCluster({ id: clusterId, createdAt }))
    for (const id of sightingIds) {
      storage.sightings.add(createSighting({ id }))
      storage.clusters.upsertSignature(id, signature(id), 100)
      storage.clusters.addMembership(clusterId, id, 100)
    }
  }

  const guards = (overrides: Partial<ReviewGuards> = {}): ReviewGuards => ({
    reviewableIds: overrides.reviewableIds ?? new Set(),
    splittableIds: overrides.splittableIds ?? new Set(),
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

  it('clears the survivor verdict on merge so the merged cluster is re-classified', () => {
    seedCluster('older', 100, ['s1'])
    seedCluster('newer', 200, ['s2'])
    storage.clusters.updateVerdict('older', { kind: 'procedure', mechanism: 'A script.' }, 200)
    storage.clusters.updateRecipe('older', { steps: ['Open the tool'], variables: ['name'] }, 200)

    validateAndApply(
      storage,
      { merges: [{ merge: ['newer', 'older'], label: 'Merged process', description: '' }] },
      guards({
        reviewableIds: new Set(['older', 'newer']),
        mergeCandidatePairs: new Set([mergePairKey('older', 'newer')]),
      }),
      'test-model',
      5000,
    )

    const survivor = storage.clusters.getById('older')!
    expect(survivor.kind).toBe('')
    expect(survivor.mechanism).toBe('')
    // The pre-merge recipe is stale for the merged cluster; it must be cleared too.
    expect(survivor.steps).toEqual([])
    expect(survivor.variables).toEqual([])
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

  it('rejects a chained merge with a pair the LLM never judged', () => {
    seedCluster('a', 100, ['s1'])
    seedCluster('b', 200, ['s2'])
    seedCluster('c', 300, ['s3'])

    const result = validateAndApply(
      storage,
      { merges: [{ merge: ['a', 'b', 'c'], label: 'Chain', description: '' }] },
      guards({
        reviewableIds: new Set(['a', 'b', 'c']),
        // a~b and b~c were candidates, a~c never was — chaining is how
        // unrelated clusters ratchet together.
        mergeCandidatePairs: new Set([mergePairKey('a', 'b'), mergePairKey('b', 'c')]),
      }),
      'test-model',
      5000,
    )

    expect(result.merged).toBe(0)
    expect(storage.clusters.getMemberCount('a')).toBe(1)
  })

  it('accepts a multi-merge when every pair is a candidate', () => {
    seedCluster('a', 100, ['s1'])
    seedCluster('b', 200, ['s2'])
    seedCluster('c', 300, ['s3'])

    const result = validateAndApply(
      storage,
      { merges: [{ merge: ['a', 'b', 'c'], label: 'Triple', description: '' }] },
      guards({
        reviewableIds: new Set(['a', 'b', 'c']),
        mergeCandidatePairs: new Set([
          mergePairKey('a', 'b'),
          mergePairKey('b', 'c'),
          mergePairKey('a', 'c'),
        ]),
      }),
      'test-model',
      5000,
    )

    expect(result.merged).toBe(2)
    expect(storage.clusters.getMemberCount('a')).toBe(3)
  })

  it('records declines for candidate pairs the LLM left unmerged', () => {
    seedCluster('a', 100, ['s1'])
    seedCluster('b', 200, ['s2'])
    seedCluster('c', 300, ['s3'])

    validateAndApply(
      storage,
      { merges: [{ merge: ['a', 'b'], label: 'Merged', description: '' }] },
      guards({
        reviewableIds: new Set(['a', 'b', 'c']),
        mergeCandidatePairs: new Set([mergePairKey('a', 'b'), mergePairKey('a', 'c')]),
      }),
      'test-model',
      5000,
    )

    const declined = storage.clusters.getActiveMergeDeclines(0)
    expect(declined.has(mergePairKey('a', 'c'))).toBe(true)
    expect(declined.has(mergePairKey('a', 'b'))).toBe(false)
  })

  it('does not record declines for pairs referencing a cluster deleted by a merge', () => {
    seedCluster('a', 100, ['s1'])
    seedCluster('b', 200, ['s2'])
    seedCluster('c', 300, ['s3'])

    // b merges into a and is deleted; the unmerged (b, c) pair must not leave
    // a decline row pointing at the dead id.
    validateAndApply(
      storage,
      { merges: [{ merge: ['a', 'b'], label: 'Merged', description: '' }] },
      guards({
        reviewableIds: new Set(['a', 'b', 'c']),
        mergeCandidatePairs: new Set([mergePairKey('a', 'b'), mergePairKey('b', 'c')]),
      }),
      'test-model',
      5000,
    )

    expect(storage.clusters.getActiveMergeDeclines(0).size).toBe(0)
  })

  it('declines nothing on a degenerate empty review response', () => {
    seedCluster('a', 100, ['s1'])
    seedCluster('b', 200, ['s2'])

    validateAndApply(
      storage,
      {},
      guards({
        reviewableIds: new Set(['a', 'b']),
        mergeCandidatePairs: new Set([mergePairKey('a', 'b')]),
      }),
      'test-model',
      5000,
    )

    expect(storage.clusters.getActiveMergeDeclines(0).size).toBe(0)
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

  it('splits a cluster keeping the original id on the largest group', () => {
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
      guards({ reviewableIds: new Set(['fresh']), splittableIds: new Set(['fresh']) }),
      'test-model',
      5000,
    )

    expect(result.split).toBe(1)

    const clusters = storage.clusters.getAllWithStats()
    expect(clusters).toHaveLength(2)
    // The largest group (A, plus unassigned s4) keeps the stable id.
    const survivor = storage.clusters.getById('fresh')!
    expect(survivor.label).toBe('Group A')
    expect(survivor.kind).toBe('')
    expect(
      storage.clusters
        .getMembers('fresh')
        .map((s) => s.id)
        .sort(),
    ).toEqual(['s1', 's2', 's4'])
    const groupB = clusters.find((c) => c.label === 'Group B')!
    expect(storage.clusters.getMembers(groupB.id).map((s) => s.id)).toEqual(['s3'])
    expect(groupB.centroid).not.toBeNull()
  })

  it('refuses to split a cluster that was not offered as splittable', () => {
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
      guards({ reviewableIds: new Set(['stable']) }), // not in splittableIds
      'test-model',
      5000,
    )

    expect(result.split).toBe(0)
    expect(storage.clusters.getById('stable')).not.toBeNull()
    expect(storage.clusters.getMemberCount('stable')).toBe(2)
  })

  it('re-splits an incoherent cluster by geometry, largest group keeping the id', () => {
    seedCluster('mess', 100, ['s1', 's2', 's3', 's4', 's5'], (id) =>
      ['s1', 's2', 's3'].includes(id) ? v(1) : v(0, 1),
    )
    storage.clusters.updateLabel('mess', 'Umbrella label', 'Everything.', 'test-model', 5, 100)

    const result = validateAndApply(
      storage,
      { clusters: [{ id: 'mess', incoherent: true }] },
      guards({ reviewableIds: new Set(['mess']), splittableIds: new Set(['mess']) }),
      'test-model',
      5000,
    )

    expect(result.split).toBe(1)
    // Groups come out unlabeled — the next review names them.
    const survivor = storage.clusters.getById('mess')!
    expect(survivor.label).toBe('')
    expect(
      storage.clusters
        .getMembers('mess')
        .map((s) => s.id)
        .sort(),
    ).toEqual(['s1', 's2', 's3'])
    const offshoot = storage.clusters.getAll().find((c) => c.id !== 'mess')!
    expect(
      storage.clusters
        .getMembers(offshoot.id)
        .map((s) => s.id)
        .sort(),
    ).toEqual(['s4', 's5'])
  })

  it('ignores an incoherent verdict on a non-splittable cluster', () => {
    seedCluster('sampled', 100, ['s1', 's2', 's3'], (id) => (id === 's3' ? v(0, 1) : v(1)))
    storage.clusters.updateLabel('sampled', 'Healthy', '', 'test-model', 3, 100)

    const result = validateAndApply(
      storage,
      { clusters: [{ id: 'sampled', incoherent: true }] },
      guards({ reviewableIds: new Set(['sampled']) }), // not splittable
      'test-model',
      5000,
    )

    expect(result.split).toBe(0)
    expect(storage.clusters.getMemberCount('sampled')).toBe(3)
    expect(storage.clusters.getById('sampled')!.label).toBe('Healthy')
  })

  it('leaves an incoherent-flagged cluster alone when geometry finds one group', () => {
    seedCluster('tight', 100, ['s1', 's2'])
    storage.clusters.updateLabel('tight', 'Fine actually', '', 'test-model', 2, 100)

    const result = validateAndApply(
      storage,
      { clusters: [{ id: 'tight', incoherent: true }] },
      guards({ reviewableIds: new Set(['tight']), splittableIds: new Set(['tight']) }),
      'test-model',
      5000,
    )

    expect(result.split).toBe(0)
    expect(storage.clusters.getById('tight')!.label).toBe('Fine actually')
    expect(storage.clusters.getMemberCount('tight')).toBe(2)
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

  it('persists a sanitized recipe when the label verdict includes steps', () => {
    seedCluster('c1', 100, ['s1', 's2'])

    validateAndApply(
      storage,
      {
        clusters: [
          {
            id: 'c1',
            label: 'Follow up',
            description: 'x',
            steps: ['Open the thread in Gmail (mail.google.com)', 'Email jane@acme.co the recap'],
            variables: ['customer name'],
          },
        ],
      },
      guards({ reviewableIds: new Set(['c1']) }),
      'test-model',
      5000,
    )

    const cluster = storage.clusters.getById('c1')!
    expect(cluster.steps[0]).toBe('Open the thread in Gmail (mail.google.com)')
    // scrubPII backstop runs end-to-end through sanitizeRecipe.
    expect(cluster.steps[1]).toBe('Email [redacted] the recap')
    expect(cluster.variables).toEqual(['customer name'])
  })

  it('keeps an existing recipe when a relabel returns no steps', () => {
    seedCluster('c1', 100, ['s1', 's2'])
    storage.clusters.updateRecipe('c1', { steps: ['Old step'], variables: ['old'] }, 200)

    validateAndApply(
      storage,
      // A relabel that omits steps (returns only variables) must not wipe the recipe.
      { clusters: [{ id: 'c1', label: 'Renamed', description: 'x', variables: [] }] },
      guards({ reviewableIds: new Set(['c1']) }),
      'test-model',
      5000,
    )

    const cluster = storage.clusters.getById('c1')!
    expect(cluster.label).toBe('Renamed')
    expect(cluster.steps).toEqual(['Old step'])
    expect(cluster.variables).toEqual(['old'])
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

  it('does not wipe an existing verdict when a relabel kind fails sanitization', () => {
    seedCluster('c1', 100, ['s1', 's2'])
    storage.clusters.updateVerdict('c1', { kind: 'procedure', mechanism: 'A script.' }, 200)

    validateAndApply(
      storage,
      { clusters: [{ id: 'c1', label: 'Renamed', description: '', kind: 'Procedure' }] },
      guards({ reviewableIds: new Set(['c1']) }),
      'test-model',
      5000,
    )

    const cluster = storage.clusters.getById('c1')!
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
