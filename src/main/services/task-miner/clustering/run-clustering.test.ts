import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { StorageService } from '@main/storage'
import { applyMigrations } from '@main/storage/migrator'
import { deleteDbFiles, v } from '@main/storage/test-utils'
import type { Sighting } from '@main/storage/sighting-repository'
import type { InferenceProvider } from '@main/llm'
import { runClustering, type ClusteringDeps } from './index'
import { averageLinkageGroupIndices } from './attach'
import { normalize } from './vector-math'
import type { ReviewInput } from './types'

const createSighting = (overrides: Partial<Sighting> & { id: string }): Sighting => ({
  id: overrides.id,
  title: overrides.title ?? 'Test sighting',
  subject: overrides.subject ?? '',
  description: overrides.description ?? 'Did the thing',
  steps: overrides.steps ?? [],
  apps: overrides.apps ?? ['TestApp'],
  activityIds: overrides.activityIds ?? [],
  startedAt: overrides.startedAt ?? 1000,
  endedAt: overrides.endedAt ?? 2000,
  interactionMin: overrides.interactionMin ?? 5,
  runId: overrides.runId ?? 'run-1',
  detectedAt: overrides.detectedAt ?? Date.now(),
})

// Deterministic stand-in for the embedding model: keyword → direction.
// Unknown text embeds to the zero vector (→ unclusterable, like empty text).
const DIRS: Record<string, number[]> = {
  alpha: v(1),
  beta: v(0, 1),
  gamma: v(0, 0, 1),
}
const fakeEmbed = async (text: string): Promise<number[]> => {
  for (const [word, dir] of Object.entries(DIRS)) {
    if (text.includes(word)) return dir
  }
  return new Array<number>(384).fill(0)
}
const fakeEmbedder = { embedBatch: (texts: string[]) => Promise.all(texts.map(fakeEmbed)) }

describe('runClustering', () => {
  const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_run_clustering_test.db')
  let storage: StorageService

  const cluster = (overrides: Partial<ClusteringDeps> = {}) =>
    runClustering({ storage, embedder: fakeEmbedder, model: 'test-model', ...overrides })

  beforeEach(() => {
    deleteDbFiles(TEST_DB_PATH)
    storage = new StorageService(TEST_DB_PATH)
    applyMigrations(storage.getDatabase())
  })

  afterEach(() => {
    storage.close()
    deleteDbFiles(TEST_DB_PATH)
  })

  it('bootstraps the whole backlog, then attaches new sightings to stable cluster ids', async () => {
    // Two sightings about the same task, one unrelated, one whose text embeds
    // to nothing at all.
    storage.sightings.add(createSighting({ id: 's1', title: 'alpha task' }))
    storage.sightings.add(createSighting({ id: 's2', title: 'alpha task again' }))
    storage.sightings.add(createSighting({ id: 's3', title: 'beta chore' }))
    storage.sightings.add(createSighting({ id: 's4', title: 'mystery' }))

    const first = await cluster({ now: 10_000 })

    expect(first.newSignatures).toBe(4)
    expect(first.unclustered).toBe(1)
    expect(first.attached).toBe(0)
    expect(first.newClusters).toBe(2) // {s1,s2} and {s3}; s4 has no signature
    expect(first.llmError).toBeUndefined()

    const counts = storage.clusters.getAll().map((c) => storage.clusters.getMemberCount(c.id))
    expect(counts.sort()).toEqual([1, 2])
    const pairClusterId = storage.clusters
      .getAll()
      .find((c) => storage.clusters.getMemberCount(c.id) === 2)!.id

    // Second run: a near-duplicate sighting attaches to the SAME cluster id.
    storage.sightings.add(createSighting({ id: 's5', title: 'alpha once more' }))

    const second = await cluster({ now: 20_000 })
    expect(second.newSignatures).toBe(1)
    expect(second.attached).toBe(1)
    expect(second.newClusters).toBe(0)

    expect(storage.clusters.getMemberCount(pairClusterId)).toBe(3)

    // Third run with nothing new is a no-op.
    const third = await cluster({ now: 30_000 })
    expect(third.newSignatures).toBe(0)
    expect(third.attached).toBe(0)
    expect(third.newClusters).toBe(0)
  })

  it('drops pruned sightings from clusters and deletes emptied clusters', async () => {
    storage.sightings.add(createSighting({ id: 'stays', title: 'alpha', startedAt: Date.now() }))
    storage.sightings.add(createSighting({ id: 'goes', title: 'beta', startedAt: 0 }))

    await cluster({ now: 10_000 })
    expect(storage.clusters.getAll()).toHaveLength(2)

    storage.sightings.pruneOlderThan(90)
    await cluster({ now: 20_000 })

    const remaining = storage.clusters.getAll()
    expect(remaining).toHaveLength(1)
    expect(storage.clusters.getMemberCount(remaining[0].id)).toBe(1)
  })

  it('labels and classifies multi-member clusters through the injected review step', async () => {
    storage.sightings.add(
      createSighting({
        id: 's1',
        title: 'alpha task',
        description: 'Did the thing. Replace with: a cron script.',
      }),
    )
    storage.sightings.add(
      createSighting({
        id: 's2',
        title: 'alpha task',
        description: 'Did the thing again. Replace with: a cron script.',
      }),
    )
    storage.sightings.add(createSighting({ id: 's3', title: 'beta chore' }))

    let seenInput: ReviewInput | null = null
    const summary = await cluster({
      // The injected review step makes the provider unused; it only gates the phase.
      provider: {} as InferenceProvider,
      now: 10_000,
      review: async (input) => {
        seenInput = input
        return {
          output: {
            clusters: input.clusters.map((c) => ({
              id: c.id,
              label: 'Do the recurring thing',
              description: 'Typically opens TestApp and does the thing.',
              kind: 'procedure',
              mechanism: 'A nightly cron script that does the thing.',
              steps: ['TestApp: do the thing'],
              variables: [],
            })),
          },
          tokenUsage: { input: 100, output: 50 },
        }
      },
    })

    // Only the 2-member cluster needs a label; the singleton is not shown.
    expect(seenInput!.clusters).toHaveLength(1)
    expect(seenInput!.clusters[0].splittable).toBe(true)
    expect(seenInput!.clusters[0].members).toHaveLength(2)
    expect(seenInput!.clusters[0].stats).toEqual({
      times_seen: 2,
      span_days: 1,
      median_active_min: 5,
    })
    expect(summary.labeled).toBe(1)
    expect(summary.tokenUsage).toEqual({ input: 100, output: 50 })

    const labeled = storage.clusters.getAll().find((c) => c.label !== '')!
    expect(labeled.label).toBe('Do the recurring thing')
    expect(labeled.labeledSize).toBe(2)
    expect(labeled.mechanism).toBe('A nightly cron script that does the thing.')
    expect(labeled.steps).toEqual(['TestApp: do the thing'])
  })

  it('shows member steps to the review only on the most recent sample members', async () => {
    // 7 same-task sightings, each with its own run steps; the review sample
    // should carry steps only on the MAX_STEPPED_SAMPLE_MEMBERS most recent.
    for (let i = 1; i <= 7; i++) {
      storage.sightings.add(
        createSighting({
          id: `s${i}`,
          title: 'alpha task',
          startedAt: i * 1000,
          endedAt: i * 1000 + 500,
          steps: [`TestApp: step of run ${i}`],
        }),
      )
    }

    let seenInput: ReviewInput | null = null
    await cluster({
      provider: {} as InferenceProvider,
      now: 10_000,
      review: async (input) => {
        seenInput = input
        return { output: {}, tokenUsage: { input: 0, output: 0 } }
      },
    })

    const members = seenInput!.clusters[0].members
    expect(members).toHaveLength(7)
    expect(members.slice(0, 2).every((m) => m.steps === undefined)).toBe(true)
    expect(members.slice(2).map((m) => m.steps)).toEqual(
      [3, 4, 5, 6, 7].map((i) => [`TestApp: step of run ${i}`]),
    )
  })

  it('does not re-review a fully reviewed non-procedure cluster', async () => {
    storage.sightings.add(createSighting({ id: 's1', title: 'alpha task' }))
    storage.sightings.add(createSighting({ id: 's2', title: 'alpha task' }))

    // A complete review: label, non-procedure classification, and a recipe.
    await cluster({
      provider: {} as InferenceProvider,
      now: 10_000,
      review: async (input) => ({
        output: {
          clusters: input.clusters.map((c) => ({
            id: c.id,
            label: 'Thing',
            description: '',
            kind: 'monitoring',
            steps: ['TestApp: check it'],
          })),
        },
        tokenUsage: { input: 0, output: 0 },
      }),
    })
    const reviewed = storage.clusters.getAll().find((c) => c.label === 'Thing')!
    expect(reviewed.mechanism).toBe('')
    expect(reviewed.steps).toEqual(['TestApp: check it'])

    // Judged not-automatable is terminal — with nothing else to review, a
    // later run has no review work at all.
    storage.sightings.add(createSighting({ id: 's9', title: 'beta chore' }))
    let reviewCalled = false
    await cluster({
      provider: {} as InferenceProvider,
      now: 20_000,
      review: async () => {
        reviewCalled = true
        return { output: {}, tokenUsage: { input: 0, output: 0 } }
      },
    })
    expect(reviewCalled).toBe(false)
  })

  it('re-reviews a labeled cluster whose recipe is still missing', async () => {
    storage.sightings.add(createSighting({ id: 's1', title: 'alpha task' }))
    storage.sightings.add(createSighting({ id: 's2', title: 'alpha task' }))

    const noRecipeRound = async () => ({ output: null, tokenUsage: { input: 0, output: 0 } })

    // First review labels and classifies but returns no steps.
    await cluster({
      provider: {} as InferenceProvider,
      now: 10_000,
      review: async (input) => ({
        output: {
          clusters: input.clusters.map((c) => ({
            id: c.id,
            label: 'Thing',
            description: '',
            kind: 'monitoring',
          })),
        },
        tokenUsage: { input: 0, output: 0 },
      }),
      recipeReview: noRecipeRound,
    })
    const labeled = storage.clusters.getAll().find((c) => c.label === 'Thing')!
    expect(labeled.steps).toEqual([])

    // A later run re-shows it (steps empty) even though nothing else changed.
    storage.sightings.add(createSighting({ id: 's9', title: 'beta chore' }))
    let seenInput: ReviewInput | null = null
    await cluster({
      provider: {} as InferenceProvider,
      now: 20_000,
      review: async (input) => {
        seenInput = input
        return { output: {}, tokenUsage: { input: 0, output: 0 } }
      },
      recipeReview: noRecipeRound,
    })
    expect(seenInput!.clusters.map((c) => c.label)).toContain('Thing')
    // Review input is sighting-only: apps come off the sighting, no domains.
    const member = seenInput!.clusters[0].members[0]
    expect(member.apps).toEqual(['TestApp'])
    expect(member).not.toHaveProperty('domains')
  })

  it('recipe round fills clusters the main review left stepless, same pass', async () => {
    storage.sightings.add(createSighting({ id: 's1', title: 'alpha task' }))
    storage.sightings.add(createSighting({ id: 's2', title: 'alpha task' }))

    let roundInput: ReviewInput | null = null
    const summary = await cluster({
      provider: {} as InferenceProvider,
      now: 10_000,
      review: async (input) => ({
        output: {
          clusters: input.clusters.map((c) => ({ id: c.id, label: 'Thing', description: '' })),
        },
        tokenUsage: { input: 10, output: 10 },
      }),
      recipeReview: async (input) => {
        roundInput = input
        return {
          output: {
            clusters: input.clusters.map((c) => ({
              id: c.id,
              label: c.label,
              description: 'd',
              kind: 'procedure',
              mechanism: 'A script.',
              steps: ['TestApp: do the thing', 'TestApp: confirm'],
              variables: ['object name'],
            })),
          },
          tokenUsage: { input: 5, output: 5 },
        }
      },
    })

    expect(roundInput!.clusters.map((c) => c.label)).toEqual(['Thing'])
    expect(roundInput!.mergeCandidates).toEqual([])
    const filled = storage.clusters.getAll().find((c) => c.label === 'Thing')!
    expect(filled.steps).toEqual(['TestApp: do the thing', 'TestApp: confirm'])
    expect(filled.mechanism).toBe('A script.')
    expect(summary.tokenUsage).toEqual({ input: 15, output: 15 })
  })

  it('recipe round cannot restructure clusters', async () => {
    storage.sightings.add(createSighting({ id: 's1', title: 'alpha task' }))
    storage.sightings.add(createSighting({ id: 's2', title: 'alpha task' }))
    storage.sightings.add(createSighting({ id: 's3', title: 'beta chore' }))
    storage.sightings.add(createSighting({ id: 's4', title: 'beta chore' }))

    await cluster({
      provider: {} as InferenceProvider,
      now: 10_000,
      review: async (input) => ({
        output: {
          clusters: input.clusters.map((c) => ({ id: c.id, label: 'Thing', description: '' })),
        },
        tokenUsage: { input: 0, output: 0 },
      }),
      recipeReview: async (input) => ({
        output: {
          clusters: input.clusters.map((c, i) =>
            i === 0
              ? {
                  id: c.id,
                  split: [
                    { label: 'A', description: '', sighting_ids: ['s1'] },
                    { label: 'B', description: '', sighting_ids: ['s2'] },
                  ],
                }
              : { id: c.id, label: c.label, description: '', steps: ['TestApp: x'], variables: [] },
          ),
          merges: [{ merge: input.clusters.map((c) => c.id), label: 'No', description: '' }],
        },
        tokenUsage: { input: 0, output: 0 },
      }),
    })

    // Both clusters survive: the split and merge were dropped by the guards.
    const clusters = storage.clusters.getAll()
    expect(clusters).toHaveLength(2)
    expect(clusters.every((c) => storage.clusters.getMemberCount(c.id) === 2)).toBe(true)
  })

  it('runs the recipe round on a pass with nothing new to group', async () => {
    storage.sightings.add(createSighting({ id: 's1', title: 'alpha task' }))
    storage.sightings.add(createSighting({ id: 's2', title: 'alpha task' }))
    storage.clusters.create({
      id: 'c1',
      label: 'Thing',
      description: '',
      centroid: normalize(v(1)),
      mechanism: '',
      steps: [],
      variables: [],
      labeledSize: 2,
      createdAt: 100,
    })
    storage.clusters.upsertSignature('s1', v(1))
    storage.clusters.upsertSignature('s2', v(1))
    storage.clusters.addMembership('c1', 's1')
    storage.clusters.addMembership('c1', 's2')

    let mainReviewCalled = false
    await cluster({
      provider: {} as InferenceProvider,
      now: 10_000,
      review: async () => {
        mainReviewCalled = true
        return { output: {}, tokenUsage: { input: 0, output: 0 } }
      },
      recipeReview: async (input) => ({
        output: {
          clusters: input.clusters.map((c) => ({
            id: c.id,
            label: c.label,
            description: '',
            steps: ['TestApp: do it'],
            variables: [],
          })),
        },
        tokenUsage: { input: 0, output: 0 },
      }),
    })

    expect(mainReviewCalled).toBe(false)
    expect(storage.clusters.getById('c1')!.steps).toEqual(['TestApp: do it'])
  })

  it('skips the recipe round when every labeled cluster has its recipe', async () => {
    storage.sightings.add(createSighting({ id: 's1', title: 'alpha task' }))
    storage.sightings.add(createSighting({ id: 's2', title: 'alpha task' }))

    let roundCalled = false
    await cluster({
      provider: {} as InferenceProvider,
      now: 10_000,
      review: async (input) => ({
        output: {
          clusters: input.clusters.map((c) => ({
            id: c.id,
            label: 'Thing',
            description: '',
            kind: 'monitoring',
            steps: ['TestApp: check it'],
            variables: [],
          })),
        },
        tokenUsage: { input: 0, output: 0 },
      }),
      recipeReview: async () => {
        roundCalled = true
        return { output: null, tokenUsage: { input: 0, output: 0 } }
      },
    })

    expect(roundCalled).toBe(false)
  })

  it('survives a throwing review step without losing deterministic progress', async () => {
    storage.sightings.add(createSighting({ id: 's1', title: 'alpha task' }))
    storage.sightings.add(createSighting({ id: 's2', title: 'alpha task' }))

    const summary = await cluster({
      provider: {} as InferenceProvider,
      now: 10_000,
      review: async () => {
        throw new Error('boom')
      },
    })

    expect(summary.llmError).toBe('boom')
    expect(summary.newClusters).toBe(1)
    expect(storage.clusters.getMemberCount(storage.clusters.getAll()[0].id)).toBe(2)
  })

  it('heals sightings signed by a crashed run that never grouped them', async () => {
    // Signature persisted, but no membership — the state left behind when a
    // run dies between signing and grouping.
    storage.sightings.add(createSighting({ id: 'stranded', title: 'alpha task' }))
    storage.clusters.upsertSignature('stranded', v(1))

    const summary = await cluster({ now: 10_000 })

    expect(summary.newSignatures).toBe(0)
    expect(summary.newClusters).toBe(1)
    expect(storage.clusters.getMemberCount(storage.clusters.getAll()[0].id)).toBe(1)
  })

  it('evicts members stranded far from their own centroid', async () => {
    // A cluster drifted by an earlier merge: two alpha members and one beta,
    // centroid stuck between them. The beta member sits at cos 0.447 < 0.6.
    for (const [id, title] of [
      ['m1', 'alpha one'],
      ['m2', 'alpha two'],
      ['m3', 'beta odd one out'],
    ] as const) {
      storage.sightings.add(createSighting({ id, title }))
    }
    storage.clusters.create({
      id: 'drifted',
      label: 'Driftwood',
      description: '',
      centroid: normalize(v(2, 1)),
      mechanism: '',
      steps: [],
      variables: [],
      labeledSize: 3,
      createdAt: 100,
    })
    storage.clusters.upsertSignature('m1', v(1))
    storage.clusters.upsertSignature('m2', v(1))
    storage.clusters.upsertSignature('m3', v(0, 1))
    for (const id of ['m1', 'm2', 'm3']) storage.clusters.addMembership('drifted', id)

    // Any new sighting triggers a pass; gamma is orthogonal to everything.
    storage.sightings.add(createSighting({ id: 's-new', title: 'gamma fresh' }))
    const summary = await cluster({ now: 10_000 })

    expect(summary.evicted).toBe(1)
    expect(
      storage.clusters
        .getMembers('drifted')
        .map((s) => s.id)
        .sort(),
    ).toEqual(['m1', 'm2'])
    const evicteeCluster = storage.clusters
      .getAll()
      .find((c) => storage.clusters.getMembers(c.id).some((s) => s.id === 'm3'))!
    expect(storage.clusters.getMemberCount(evicteeCluster.id)).toBe(1)
  })

  it('offers a low-coherence cluster as splittable with its full member list', async () => {
    // Four members, two directions at cos 0.4 — every member clears the
    // eviction floor but the mean member→centroid coherence is ≈ 0.837 < 0.85.
    const other = normalize(v(0.4, Math.sqrt(1 - 0.16)))!
    for (const [id, title] of [
      ['s1', 'alpha one'],
      ['s2', 'alpha two'],
      ['s3', 'other one'],
      ['s4', 'other two'],
    ] as const) {
      storage.sightings.add(createSighting({ id, title }))
    }
    storage.clusters.create({
      id: 'mixed',
      label: 'Umbrella',
      description: '',
      centroid: normalize(v(1).map((x, i) => x + other[i]))!,
      mechanism: 'Something.',
      steps: [],
      variables: [],
      labeledSize: 4,
      createdAt: 100,
    })
    storage.clusters.upsertSignature('s1', v(1))
    storage.clusters.upsertSignature('s2', v(1))
    storage.clusters.upsertSignature('s3', other)
    storage.clusters.upsertSignature('s4', other)
    for (const id of ['s1', 's2', 's3', 's4']) storage.clusters.addMembership('mixed', id)

    storage.sightings.add(createSighting({ id: 's-new', title: 'gamma fresh' }))

    let seenInput: ReviewInput | null = null
    const summary = await cluster({
      provider: {} as InferenceProvider,
      now: 10_000,
      review: async (input) => {
        seenInput = input
        return {
          output: { clusters: [{ id: 'mixed', incoherent: true }] },
          tokenUsage: { input: 0, output: 0 },
        }
      },
    })

    const shown = seenInput!.clusters.find((c) => c.id === 'mixed')!
    expect(shown.splittable).toBe(true)
    expect(shown.members).toHaveLength(4)

    // The incoherent verdict re-groups by geometry: alphas keep the id.
    expect(summary.split).toBe(1)
    expect(
      storage.clusters
        .getMembers('mixed')
        .map((s) => s.id)
        .sort(),
    ).toEqual(['s1', 's2'])
    expect(storage.clusters.getById('mixed')!.label).toBe('')
    const offshoot = storage.clusters
      .getAll()
      .find((c) => c.id !== 'mixed' && storage.clusters.getMembers(c.id).length === 2)!
    expect(
      storage.clusters
        .getMembers(offshoot.id)
        .map((s) => s.id)
        .sort(),
    ).toEqual(['s3', 's4'])
  })

  it('routes splittable probes and the incoherent re-split through clusterVectors', async () => {
    // Same geometry as the low-coherence test above, with the ml-worker path
    // injected: all linkage must go through clusterVectors, and the re-split
    // groups precomputed from it must produce the same partition.
    const other = normalize(v(0.4, Math.sqrt(1 - 0.16)))!
    for (const [id, title] of [
      ['s1', 'alpha one'],
      ['s2', 'alpha two'],
      ['s3', 'other one'],
      ['s4', 'other two'],
    ] as const) {
      storage.sightings.add(createSighting({ id, title }))
    }
    storage.clusters.create({
      id: 'mixed',
      label: 'Umbrella',
      description: '',
      centroid: normalize(v(1).map((x, i) => x + other[i]))!,
      mechanism: '',
      steps: [],
      variables: [],
      labeledSize: 4,
      createdAt: 100,
    })
    storage.clusters.upsertSignature('s1', v(1))
    storage.clusters.upsertSignature('s2', v(1))
    storage.clusters.upsertSignature('s3', other)
    storage.clusters.upsertSignature('s4', other)
    for (const id of ['s1', 's2', 's3', 's4']) storage.clusters.addMembership('mixed', id)

    storage.sightings.add(createSighting({ id: 's-new', title: 'gamma fresh' }))

    const linkageCalls: number[] = []
    const summary = await cluster({
      provider: {} as InferenceProvider,
      now: 10_000,
      clusterVectors: async (vectors, threshold) => {
        linkageCalls.push(vectors.length)
        return averageLinkageGroupIndices(vectors, threshold)
      },
      review: async () => ({
        output: { clusters: [{ id: 'mixed', incoherent: true }] },
        tokenUsage: { input: 0, output: 0 },
      }),
    })

    // First-cut grouping (1 leftover), the splittable probe (4 members), and
    // the re-split precompute (4 members) all rode the injected linkage.
    expect(linkageCalls).toEqual([1, 4, 4])
    expect(summary.split).toBe(1)
    expect(
      storage.clusters
        .getMembers('mixed')
        .map((s) => s.id)
        .sort(),
    ).toEqual(['s1', 's2'])
  })
})
