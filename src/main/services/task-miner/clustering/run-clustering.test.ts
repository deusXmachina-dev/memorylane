import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { StorageService } from '@main/storage'
import { applyMigrations } from '@main/storage/migrator'
import { deleteDbFiles, v, createStoredActivity } from '@main/storage/test-utils'
import type { Sighting } from '@main/storage/sighting-repository'
import type { InferenceProvider } from '@main/llm'
import { runClustering } from './index'
import type { ReviewInput } from './types'

const createSighting = (overrides: Partial<Sighting> & { id: string }): Sighting => ({
  id: overrides.id,
  title: overrides.title ?? 'Test sighting',
  description: overrides.description ?? 'Did the thing',
  apps: overrides.apps ?? ['TestApp'],
  activityIds: overrides.activityIds ?? [],
  startedAt: overrides.startedAt ?? 1000,
  endedAt: overrides.endedAt ?? 2000,
  interactionMin: overrides.interactionMin ?? 5,
  runId: overrides.runId ?? 'run-1',
  detectedAt: overrides.detectedAt ?? Date.now(),
})

describe('runClustering', () => {
  const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_run_clustering_test.db')
  let storage: StorageService

  const addActivity = (id: string, vector: number[]) =>
    storage.activities.add(createStoredActivity({ id, vector }))

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
    // Two sightings pointing the same direction, one orthogonal, one with no
    // resolvable activity vectors at all.
    addActivity('a1', v(1))
    addActivity('a2', v(1))
    addActivity('a3', v(0, 1))
    storage.sightings.add(createSighting({ id: 's1', activityIds: ['a1'] }))
    storage.sightings.add(createSighting({ id: 's2', activityIds: ['a2'] }))
    storage.sightings.add(createSighting({ id: 's3', activityIds: ['a3'] }))
    storage.sightings.add(createSighting({ id: 's4', activityIds: ['gone'] }))

    const first = await runClustering({ storage, model: 'test-model', now: 10_000 })

    expect(first.newSignatures).toBe(4)
    expect(first.unclustered).toBe(1)
    expect(first.attached).toBe(0)
    expect(first.newClusters).toBe(2) // {s1,s2} and {s3}; s4 has no signature
    expect(first.llmError).toBeUndefined()

    const stats = storage.clusters.getAllWithStats()
    expect(stats.map((c) => c.timesSeen).sort()).toEqual([1, 2])
    const pairClusterId = stats.find((c) => c.timesSeen === 2)!.id

    // Second run: a near-duplicate sighting attaches to the SAME cluster id.
    addActivity('a5', v(1))
    storage.sightings.add(createSighting({ id: 's5', activityIds: ['a5'] }))

    const second = await runClustering({ storage, model: 'test-model', now: 20_000 })
    expect(second.newSignatures).toBe(1)
    expect(second.attached).toBe(1)
    expect(second.newClusters).toBe(0)

    const pairCluster = storage.clusters.getAllWithStats().find((c) => c.id === pairClusterId)!
    expect(pairCluster.timesSeen).toBe(3)

    // Third run with nothing new is a no-op.
    const third = await runClustering({ storage, model: 'test-model', now: 30_000 })
    expect(third.newSignatures).toBe(0)
    expect(third.attached).toBe(0)
    expect(third.newClusters).toBe(0)
  })

  it('drops pruned sightings from clusters and deletes emptied clusters', async () => {
    addActivity('a1', v(1))
    addActivity('a2', v(0, 1))
    storage.sightings.add(createSighting({ id: 'stays', activityIds: ['a1'] }))
    storage.sightings.add(createSighting({ id: 'goes', activityIds: ['a2'], detectedAt: 0 }))

    await runClustering({ storage, model: 'test-model', now: 10_000 })
    expect(storage.clusters.getAll()).toHaveLength(2)

    storage.sightings.pruneOlderThan(90)
    await runClustering({ storage, model: 'test-model', now: 20_000 })

    const stats = storage.clusters.getAllWithStats()
    expect(stats).toHaveLength(1)
    expect(stats[0].timesSeen).toBe(1)
  })

  it('labels and classifies multi-member clusters through the injected review step', async () => {
    addActivity('a1', v(1))
    addActivity('a2', v(1))
    addActivity('a3', v(0, 1))
    storage.sightings.add(
      createSighting({
        id: 's1',
        activityIds: ['a1'],
        description: 'Did the thing. Replace with: a cron script.',
      }),
    )
    storage.sightings.add(
      createSighting({
        id: 's2',
        activityIds: ['a2'],
        description: 'Did the thing again. Replace with: a cron script.',
      }),
    )
    storage.sightings.add(createSighting({ id: 's3', activityIds: ['a3'] }))

    let seenInput: ReviewInput | null = null
    const summary = await runClustering({
      storage,
      // The injected review step makes the provider unused; it only gates the phase.
      provider: {} as InferenceProvider,
      model: 'test-model',
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
            })),
          },
          tokenUsage: { input: 100, output: 50 },
        }
      },
    })

    // Only the 2-member cluster needs a label; the singleton is not shown.
    expect(seenInput!.clusters).toHaveLength(1)
    expect(seenInput!.clusters[0].new).toBe(true)
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
    expect(labeled.labelModel).toBe('test-model')
    expect(labeled.labeledSize).toBe(2)
    expect(labeled.kind).toBe('procedure')
    expect(labeled.mechanism).toBe('A nightly cron script that does the thing.')
  })

  it('re-reviews a labeled cluster whose kind verdict is still missing', async () => {
    addActivity('a1', v(1))
    addActivity('a2', v(1))
    storage.sightings.add(createSighting({ id: 's1', activityIds: ['a1'] }))
    storage.sightings.add(createSighting({ id: 's2', activityIds: ['a2'] }))

    // First review labels but omits the kind (old-style response).
    await runClustering({
      storage,
      provider: {} as InferenceProvider,
      model: 'test-model',
      now: 10_000,
      review: async (input) => ({
        output: {
          clusters: input.clusters.map((c) => ({ id: c.id, label: 'Thing', description: '' })),
        },
        tokenUsage: { input: 0, output: 0 },
      }),
    })
    expect(storage.clusters.getAll().find((c) => c.label === 'Thing')!.kind).toBe('')

    // A later run re-shows it (kind === '') even though nothing else changed.
    addActivity('a9', v(0, 1))
    storage.sightings.add(createSighting({ id: 's9', activityIds: ['a9'] }))
    let seenInput: ReviewInput | null = null
    await runClustering({
      storage,
      provider: {} as InferenceProvider,
      model: 'test-model',
      now: 20_000,
      review: async (input) => {
        seenInput = input
        return { output: {}, tokenUsage: { input: 0, output: 0 } }
      },
    })
    expect(seenInput!.clusters.map((c) => c.label)).toContain('Thing')
  })

  it('survives a throwing review step without losing deterministic progress', async () => {
    addActivity('a1', v(1))
    addActivity('a2', v(1))
    storage.sightings.add(createSighting({ id: 's1', activityIds: ['a1'] }))
    storage.sightings.add(createSighting({ id: 's2', activityIds: ['a2'] }))

    const summary = await runClustering({
      storage,
      provider: {} as InferenceProvider,
      model: 'test-model',
      now: 10_000,
      review: async () => {
        throw new Error('boom')
      },
    })

    expect(summary.llmError).toBe('boom')
    expect(summary.newClusters).toBe(1)
    expect(storage.clusters.getAllWithStats()[0].timesSeen).toBe(2)
  })
})
