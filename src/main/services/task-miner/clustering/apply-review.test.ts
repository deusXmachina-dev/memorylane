import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { StorageService } from '@main/storage'
import { applyMigrations } from '@main/storage/migrator'
import { deleteDbFiles, v } from '@main/storage/test-utils'
import type { Cluster } from '@main/storage/cluster-repository'
import type { Sighting } from '@main/storage/sighting-repository'
import {
  applyStructure,
  applyContent,
  mergePairKey,
  sanitizeMechanism,
  type StructureGuards,
} from './apply-review'

const createSighting = (overrides: Partial<Sighting> & { id: string }): Sighting => ({
  id: overrides.id,
  title: overrides.title ?? 'Test sighting',
  subject: overrides.subject ?? '',
  description: overrides.description ?? '',
  steps: overrides.steps ?? [],
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
  mechanism: overrides.mechanism ?? '',
  steps: overrides.steps ?? [],
  variables: overrides.variables ?? [],
  labeledSize: overrides.labeledSize ?? 0,
  createdAt: overrides.createdAt ?? 1000,
})

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
    storage.clusters.upsertSignature(id, signature(id))
    storage.clusters.addMembership(clusterId, id)
  }
}

beforeEach(() => {
  deleteDbFiles(TEST_DB_PATH)
  storage = new StorageService(TEST_DB_PATH)
  applyMigrations(storage.getDatabase())
})

afterEach(() => {
  storage.close()
  deleteDbFiles(TEST_DB_PATH)
})

describe('applyStructure', () => {
  const guards = (overrides: Partial<StructureGuards> = {}): StructureGuards => ({
    reviewableIds: overrides.reviewableIds ?? new Set(),
    splittableIds: overrides.splittableIds ?? new Set(),
    mergeCandidatePairs: overrides.mergeCandidatePairs ?? new Set(),
  })

  it('merges candidate pairs into the oldest cluster regardless of LLM order', () => {
    seedCluster('older', 100, ['s1'])
    seedCluster('newer', 200, ['s2'])

    const result = applyStructure(
      storage,
      { merges: [{ merge: ['newer', 'older'] }] },
      guards({
        reviewableIds: new Set(['older', 'newer']),
        mergeCandidatePairs: new Set([mergePairKey('older', 'newer')]),
      }),
      5000,
    )

    expect(result.merged).toBe(1)
    expect(storage.clusters.getById('newer')).toBeNull()
    expect(storage.clusters.getMemberCount('older')).toBe(2)
  })

  it('clears the survivor recipe on merge so the content round redoes it', () => {
    seedCluster('older', 100, ['s1'])
    seedCluster('newer', 200, ['s2'])
    storage.clusters.updateLabel('older', 'Old label', '', 'A script.', 1)
    storage.clusters.updateRecipe('older', { steps: ['Open the tool'], variables: ['name'] })

    applyStructure(
      storage,
      { merges: [{ merge: ['newer', 'older'] }] },
      guards({
        reviewableIds: new Set(['older', 'newer']),
        mergeCandidatePairs: new Set([mergePairKey('older', 'newer')]),
      }),
      5000,
    )

    const survivor = storage.clusters.getById('older')!
    expect(survivor.steps).toEqual([])
    expect(survivor.variables).toEqual([])
    // Label and mechanism stay until the content round rewrites them — a
    // stale name beats an empty one in the meantime.
    expect(survivor.label).toBe('Old label')
    expect(survivor.mechanism).toBe('A script.')
  })

  it('rejects merges that were not proposed as candidates', () => {
    seedCluster('a', 100, ['s1'])
    seedCluster('b', 200, ['s2'])

    const result = applyStructure(
      storage,
      { merges: [{ merge: ['a', 'b'] }] },
      guards({ reviewableIds: new Set(['a', 'b']) }),
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

    const result = applyStructure(
      storage,
      { merges: [{ merge: ['a', 'b', 'c'] }] },
      guards({
        reviewableIds: new Set(['a', 'b', 'c']),
        // a~b and b~c were candidates, a~c never was — chaining is how
        // unrelated clusters ratchet together.
        mergeCandidatePairs: new Set([mergePairKey('a', 'b'), mergePairKey('b', 'c')]),
      }),
      5000,
    )

    expect(result.merged).toBe(0)
    expect(storage.clusters.getMemberCount('a')).toBe(1)
  })

  it('accepts a multi-merge when every pair is a candidate', () => {
    seedCluster('a', 100, ['s1'])
    seedCluster('b', 200, ['s2'])
    seedCluster('c', 300, ['s3'])

    const result = applyStructure(
      storage,
      { merges: [{ merge: ['a', 'b', 'c'] }] },
      guards({
        reviewableIds: new Set(['a', 'b', 'c']),
        mergeCandidatePairs: new Set([
          mergePairKey('a', 'b'),
          mergePairKey('b', 'c'),
          mergePairKey('a', 'c'),
        ]),
      }),
      5000,
    )

    expect(result.merged).toBe(2)
    expect(storage.clusters.getMemberCount('a')).toBe(3)
  })

  it('records declines for candidate pairs the LLM left unmerged', () => {
    seedCluster('a', 100, ['s1'])
    seedCluster('b', 200, ['s2'])
    seedCluster('c', 300, ['s3'])

    applyStructure(
      storage,
      { merges: [{ merge: ['a', 'b'] }] },
      guards({
        reviewableIds: new Set(['a', 'b', 'c']),
        mergeCandidatePairs: new Set([mergePairKey('a', 'b'), mergePairKey('a', 'c')]),
      }),
      5000,
    )

    const declined = storage.clusters.getActiveMergeDeclines(0)
    expect(declined.has(mergePairKey('a', 'c'))).toBe(true)
    expect(declined.has(mergePairKey('a', 'b'))).toBe(false)
  })

  it('records declines on an explicit empty merges array', () => {
    seedCluster('a', 100, ['s1'])
    seedCluster('b', 200, ['s2'])

    applyStructure(
      storage,
      { merges: [], clusters: [] },
      guards({
        reviewableIds: new Set(['a', 'b']),
        mergeCandidatePairs: new Set([mergePairKey('a', 'b')]),
      }),
      5000,
    )

    expect(storage.clusters.getActiveMergeDeclines(0).has(mergePairKey('a', 'b'))).toBe(true)
  })

  it('does not record declines for pairs referencing a cluster deleted by a merge', () => {
    seedCluster('a', 100, ['s1'])
    seedCluster('b', 200, ['s2'])
    seedCluster('c', 300, ['s3'])

    // b merges into a and is deleted; the unmerged (b, c) pair must not leave
    // a decline row pointing at the dead id.
    applyStructure(
      storage,
      { merges: [{ merge: ['a', 'b'] }] },
      guards({
        reviewableIds: new Set(['a', 'b', 'c']),
        mergeCandidatePairs: new Set([mergePairKey('a', 'b'), mergePairKey('b', 'c')]),
      }),
      5000,
    )

    expect(storage.clusters.getActiveMergeDeclines(0).size).toBe(0)
  })

  it('declines nothing on a degenerate response without a merges array', () => {
    seedCluster('a', 100, ['s1'])
    seedCluster('b', 200, ['s2'])

    applyStructure(
      storage,
      {},
      guards({
        reviewableIds: new Set(['a', 'b']),
        mergeCandidatePairs: new Set([mergePairKey('a', 'b')]),
      }),
      5000,
    )

    expect(storage.clusters.getActiveMergeDeclines(0).size).toBe(0)
  })

  it('ignores hallucinated cluster ids', () => {
    seedCluster('real', 100, ['s1'])

    const result = applyStructure(
      storage,
      { merges: [{ merge: ['real', 'ghost'] }] },
      guards({ reviewableIds: new Set(['real']) }),
      5000,
    )

    expect(result.merged).toBe(0)
    expect(storage.clusters.getById('real')).not.toBeNull()
  })

  it('splits a cluster keeping the original id and label on the largest group', () => {
    seedCluster('fresh', 100, ['s1', 's2', 's3', 's4'])
    storage.clusters.updateLabel('fresh', 'Umbrella', '', 'A script.', 4)
    storage.clusters.updateRecipe('fresh', { steps: ['Old step'], variables: [] })

    const result = applyStructure(
      storage,
      {
        clusters: [
          {
            id: 'fresh',
            split: [{ sighting_ids: ['s1', 's2'] }, { sighting_ids: ['s3'] }],
          },
        ],
      },
      guards({ reviewableIds: new Set(['fresh']), splittableIds: new Set(['fresh']) }),
      5000,
    )

    expect(result.split).toBe(1)

    const clusters = storage.clusters.getAll()
    expect(clusters).toHaveLength(2)
    // The largest group (plus unassigned s4) keeps the stable id; the stale
    // label stays until the content round renames it, the recipe is cleared.
    const survivor = storage.clusters.getById('fresh')!
    expect(survivor.label).toBe('Umbrella')
    expect(survivor.steps).toEqual([])
    expect(
      storage.clusters
        .getMembers('fresh')
        .map((s) => s.id)
        .sort(),
    ).toEqual(['s1', 's2', 's4'])
    const offshoot = clusters.find((c) => c.id !== 'fresh')!
    expect(offshoot.label).toBe('')
    expect(storage.clusters.getMembers(offshoot.id).map((s) => s.id)).toEqual(['s3'])
    expect(offshoot.centroid).not.toBeNull()
  })

  it('refuses to split a cluster that was not offered as splittable', () => {
    seedCluster('stable', 100, ['s1', 's2'])

    const result = applyStructure(
      storage,
      {
        clusters: [{ id: 'stable', split: [{ sighting_ids: ['s1'] }, { sighting_ids: ['s2'] }] }],
      },
      guards({ reviewableIds: new Set(['stable']) }), // not in splittableIds
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
    storage.clusters.updateLabel('mess', 'Umbrella label', 'Everything.', '', 5)

    const result = applyStructure(
      storage,
      { clusters: [{ id: 'mess', incoherent: true }] },
      guards({ reviewableIds: new Set(['mess']), splittableIds: new Set(['mess']) }),
      5000,
    )

    expect(result.split).toBe(1)
    expect(
      storage.clusters
        .getMembers('mess')
        .map((s) => s.id)
        .sort(),
    ).toEqual(['s1', 's2', 's3'])
    const offshoot = storage.clusters.getAll().find((c) => c.id !== 'mess')!
    expect(offshoot.label).toBe('')
    expect(
      storage.clusters
        .getMembers(offshoot.id)
        .map((s) => s.id)
        .sort(),
    ).toEqual(['s4', 's5'])
  })

  it('ignores an incoherent verdict on a non-splittable cluster', () => {
    seedCluster('sampled', 100, ['s1', 's2', 's3'], (id) => (id === 's3' ? v(0, 1) : v(1)))
    storage.clusters.updateLabel('sampled', 'Healthy', '', '', 3)

    const result = applyStructure(
      storage,
      { clusters: [{ id: 'sampled', incoherent: true }] },
      guards({ reviewableIds: new Set(['sampled']) }), // not splittable
      5000,
    )

    expect(result.split).toBe(0)
    expect(storage.clusters.getMemberCount('sampled')).toBe(3)
    expect(storage.clusters.getById('sampled')!.label).toBe('Healthy')
  })

  it('leaves an incoherent-flagged cluster alone when geometry finds one group', () => {
    seedCluster('tight', 100, ['s1', 's2'])
    storage.clusters.updateLabel('tight', 'Fine actually', '', '', 2)

    const result = applyStructure(
      storage,
      { clusters: [{ id: 'tight', incoherent: true }] },
      guards({ reviewableIds: new Set(['tight']), splittableIds: new Set(['tight']) }),
      5000,
    )

    expect(result.split).toBe(0)
    expect(storage.clusters.getById('tight')!.label).toBe('Fine actually')
    expect(storage.clusters.getMemberCount('tight')).toBe(2)
  })
})

describe('applyContent', () => {
  it('drops a label verdict on a single-member cluster', () => {
    seedCluster('solo', 100, ['s1'])

    const result = applyContent(
      storage,
      {
        clusters: [
          {
            id: 'solo',
            label: 'One-off thing',
            description: 'x',
            kind: 'monitoring',
            steps: ['App: do the thing', 'App: confirm'],
          },
        ],
      },
      new Set(['solo']),
    )

    expect(result.labeled).toBe(0)
    const cluster = storage.clusters.getById('solo')!
    expect(cluster.label).toBe('')
    expect(cluster.steps).toEqual([])
  })

  it('applies labels with the member count as labeledSize', () => {
    seedCluster('c1', 100, ['s1', 's2', 's3'])

    const result = applyContent(
      storage,
      { clusters: [{ id: 'c1', label: 'Weekly invoicing', description: 'Sends invoices.' }] },
      new Set(['c1']),
    )

    expect(result.labeled).toBe(1)
    const cluster = storage.clusters.getById('c1')!
    expect(cluster.label).toBe('Weekly invoicing')
    expect(cluster.labeledSize).toBe(3)
  })

  it('ignores verdicts for clusters outside the batch', () => {
    seedCluster('c1', 100, ['s1', 's2'])

    const result = applyContent(
      storage,
      { clusters: [{ id: 'c1', label: 'Sneaky', description: '' }] },
      new Set(['other']),
    )

    expect(result.labeled).toBe(0)
    expect(storage.clusters.getById('c1')!.label).toBe('')
  })

  it('cannot restructure: split, incoherent, and merge output are inert', () => {
    seedCluster('c1', 100, ['s1', 's2'])
    seedCluster('c2', 200, ['s3', 's4'])

    const result = applyContent(
      storage,
      {
        clusters: [
          { id: 'c1', split: [{ sighting_ids: ['s1'] }, { sighting_ids: ['s2'] }] },
          { id: 'c2', incoherent: true },
        ],
        merges: [{ merge: ['c1', 'c2'] }],
      },
      new Set(['c1', 'c2']),
    )

    expect(result.labeled).toBe(0)
    expect(storage.clusters.getAll()).toHaveLength(2)
    expect(storage.clusters.getMemberCount('c1')).toBe(2)
    expect(storage.clusters.getMemberCount('c2')).toBe(2)
  })

  it('persists a sanitized recipe when the verdict includes steps', () => {
    seedCluster('c1', 100, ['s1', 's2'])

    applyContent(
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
      new Set(['c1']),
    )

    const cluster = storage.clusters.getById('c1')!
    expect(cluster.steps[0]).toBe('Open the thread in Gmail (mail.google.com)')
    expect(cluster.steps[1]).toBe('Email [email address] the recap')
    expect(cluster.variables).toEqual(['customer name'])
  })

  it('keeps an existing recipe when a relabel returns no steps', () => {
    seedCluster('c1', 100, ['s1', 's2'])
    storage.clusters.updateRecipe('c1', { steps: ['Old step'], variables: ['old'] })

    applyContent(
      storage,
      { clusters: [{ id: 'c1', label: 'Renamed', description: 'x', variables: [] }] },
      new Set(['c1']),
    )

    const cluster = storage.clusters.getById('c1')!
    expect(cluster.label).toBe('Renamed')
    expect(cluster.steps).toEqual(['Old step'])
    expect(cluster.variables).toEqual(['old'])
  })

  it('persists the mechanism alongside the label for a procedure verdict', () => {
    seedCluster('c1', 100, ['s1', 's2'])

    applyContent(
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
      new Set(['c1']),
    )

    expect(storage.clusters.getById('c1')!.mechanism).toBe(
      'Sync the form tool to the invoicing tool.',
    )
  })

  it('keeps an existing mechanism when a relabel omits the classification', () => {
    seedCluster('c1', 100, ['s1', 's2'])
    storage.clusters.updateLabel('c1', 'Old', '', 'A script.', 2)

    applyContent(
      storage,
      { clusters: [{ id: 'c1', label: 'Renamed', description: '' }] },
      new Set(['c1']),
    )

    const cluster = storage.clusters.getById('c1')!
    expect(cluster.label).toBe('Renamed')
    expect(cluster.mechanism).toBe('A script.')
  })

  it('drops an existing mechanism when a relabel classifies without one', () => {
    seedCluster('c1', 100, ['s1', 's2'])
    storage.clusters.updateLabel('c1', 'Old', '', 'A script.', 2)

    applyContent(
      storage,
      { clusters: [{ id: 'c1', label: 'Renamed', description: '', kind: 'procedure' }] },
      new Set(['c1']),
    )

    expect(storage.clusters.getById('c1')!.mechanism).toBe('')
  })

  it('stores no mechanism when a relabel classifies as non-procedure', () => {
    seedCluster('c1', 100, ['s1', 's2'])
    storage.clusters.updateLabel('c1', 'Old', '', 'A script.', 2)

    applyContent(
      storage,
      { clusters: [{ id: 'c1', label: 'Renamed', description: '', kind: 'monitoring' }] },
      new Set(['c1']),
    )

    expect(storage.clusters.getById('c1')!.mechanism).toBe('')
  })
})

describe('sanitizeMechanism', () => {
  it('keeps the mechanism a classified verdict carries, whatever the kind', () => {
    expect(sanitizeMechanism({ id: 'x', kind: 'procedure', mechanism: 'A script.' })).toBe(
      'A script.',
    )
    expect(sanitizeMechanism({ id: 'x', kind: 'monitoring', mechanism: 'An alert.' })).toBe(
      'An alert.',
    )
  })

  it('reads a classified verdict without a mechanism as not eliminable', () => {
    expect(sanitizeMechanism({ id: 'x', kind: 'procedure' })).toBe('')
    expect(sanitizeMechanism({ id: 'x', kind: 'procedure', mechanism: '  ' })).toBe('')
    for (const kind of ['monitoring', 'ambient', 'dev-loop', 'judgment']) {
      expect(sanitizeMechanism({ id: 'x', kind })).toBe('')
    }
  })

  it('treats off-enum and omitted kinds as no judgment', () => {
    expect(sanitizeMechanism({ id: 'x', kind: 'busywork', mechanism: 'A.' })).toBeNull()
    expect(sanitizeMechanism({ id: 'x' })).toBeNull()
  })
})
