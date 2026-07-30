import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { StorageService } from '@main/storage'
import { applyMigrations } from '@main/storage/migrator'
import { deleteDbFiles } from '@main/storage/test-utils'
import {
  buildClusterInfo,
  computeClustersView,
  computeRecurrence,
  isBelowNoiseFloor,
  mean,
  resolveSteps,
  resolveTitle,
  timesPerWeek,
  type ClusterMember,
} from './cluster-view'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 6, 6, 12, 0, 0) // 2026-07-06, mid-day UTC

// Buckets are local calendar days; expectations must be TZ-agnostic.
const localMidnight = (ts: number): number => {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

describe('computeRecurrence', () => {
  it('returns empty for no sightings', () => {
    expect(computeRecurrence([], NOW)).toEqual({ unit: 'day', buckets: [] })
  })

  it('uses day buckets for a short span, starting at local midnight', () => {
    const r = computeRecurrence([NOW], NOW)
    expect(r.unit).toBe('day')
    expect(r.buckets).toEqual([{ start: localMidnight(NOW), count: 1 }])
  })

  it('zero-fills day gaps', () => {
    const r = computeRecurrence([NOW - 3 * DAY_MS, NOW], NOW)
    expect(r.unit).toBe('day')
    expect(r.buckets.map((b) => b.count)).toEqual([1, 0, 0, 1])
  })

  it('counts multiple sightings in the same day', () => {
    const r = computeRecurrence([NOW, NOW - 1000, NOW - 2000], NOW)
    expect(r.buckets.map((b) => b.count)).toEqual([3])
  })

  it('switches to week buckets once the span exceeds the bucket budget', () => {
    const r = computeRecurrence([NOW - 60 * DAY_MS, NOW], NOW)
    expect(r.unit).toBe('week')
    expect(r.buckets.reduce((s, b) => s + b.count, 0)).toBe(2)
    expect(r.buckets[r.buckets.length - 1].count).toBe(1)
  })

  it('switches to week buckets when a fractional span straddles maxBuckets+1 calendar days', () => {
    // 01:00 local; 23.5 days back lands 24 calendar days earlier — day buckets
    // would drop the oldest sighting.
    const now = localMidnight(NOW) + 60 * 60 * 1000
    const r = computeRecurrence([now - 23.5 * DAY_MS, now], now)
    expect(r.unit).toBe('week')
    expect(r.buckets.reduce((s, b) => s + b.count, 0)).toBe(2)
  })

  it('caps to the most recent maxBuckets', () => {
    const r = computeRecurrence([NOW - 100 * DAY_MS, NOW], NOW, 4)
    expect(r.unit).toBe('week')
    expect(r.buckets).toHaveLength(4)
    expect(r.buckets[0].count).toBe(0) // old sighting beyond the cap
    expect(r.buckets[3].count).toBe(1) // current bucket
  })
})

describe('resolveTitle', () => {
  it('uses the label when present', () => {
    expect(resolveTitle('Reconcile invoices', ['a', 'b'])).toBe('Reconcile invoices')
  })

  it('trims the label', () => {
    expect(resolveTitle('  Move funds  ', [])).toBe('Move funds')
  })

  it('falls back to the most common member title', () => {
    expect(resolveTitle('', ['Pay bills', 'Pay bills', 'Other'])).toBe('Pay bills')
  })

  it('breaks ties by earliest occurrence', () => {
    expect(resolveTitle('', ['First', 'Second'])).toBe('First')
  })

  it('returns a fallback when nothing is available', () => {
    expect(resolveTitle('', [])).toBe('Untitled task')
    expect(resolveTitle('   ', ['  '])).toBe('Untitled task')
  })
})

const member = (startedAt: number, title: string, steps: string[]): ClusterMember => ({
  startedAt,
  endedAt: startedAt + 1000,
  interactionMin: 1,
  title,
  apps: [],
  steps,
})

describe('resolveSteps', () => {
  it('prefers the cluster recipe over member steps', () => {
    expect(resolveSteps(['App: generalized step'], [member(1, 'Run', ['App: raw step'])])).toEqual([
      'App: generalized step',
    ])
  })

  it('falls back to the most recent member matching the modal title', () => {
    const members = [
      member(1, 'Pay bills', ['App: old way']),
      member(2, 'Other', ['App: outlier way']),
      member(3, 'Pay bills', ['App: new way']),
    ]
    expect(resolveSteps([], members)).toEqual(['App: new way'])
  })

  it('uses the most recent stepped member when no modal-title member has steps', () => {
    const members = [
      member(1, 'Pay bills', []),
      member(2, 'Pay bills', []),
      member(3, 'Other', ['App: only steps around']),
    ]
    expect(resolveSteps([], members)).toEqual(['App: only steps around'])
  })

  it('returns [] when neither recipe nor members carry steps', () => {
    expect(resolveSteps([], [member(1, 'Run', [])])).toEqual([])
    expect(resolveSteps([], [])).toEqual([])
  })
})

describe('mean', () => {
  it('returns 0 for an empty list', () => {
    expect(mean([])).toBe(0)
  })

  it('averages values', () => {
    expect(mean([4, 8])).toBe(6)
  })
})

describe('timesPerWeek', () => {
  it('scales runs over observed days to a week', () => {
    expect(timesPerWeek(5, 7)).toBe(5)
    expect(timesPerWeek(10, 14)).toBe(5)
  })

  it('returns 0 when nothing was observed', () => {
    expect(timesPerWeek(3, 0)).toBe(0)
  })
})

describe('isBelowNoiseFloor', () => {
  it('hides a singleton with little total time', () => {
    expect(isBelowNoiseFloor(1, 5)).toBe(true)
  })

  it('keeps a singleton once its total time clears the floor', () => {
    expect(isBelowNoiseFloor(1, 30)).toBe(false)
  })

  it('hides a singleton one minute short of the floor', () => {
    expect(isBelowNoiseFloor(1, 29)).toBe(true)
  })

  it('keeps anything seen twice, however small', () => {
    expect(isBelowNoiseFloor(2, 0)).toBe(false)
  })
})

describe('buildClusterInfo', () => {
  const head = {
    id: 'c1',
    label: 'Process invoices',
    description: 'Runs the batch.',
    mechanism: 'A nightly sync.',
    steps: [] as string[],
    variables: [] as string[],
  }

  it('derives stats, apps, and recurrence from the members', () => {
    const info = buildClusterInfo(
      head,
      [
        // 10-min span, 4 active → 6 idle
        {
          startedAt: NOW - DAY_MS,
          endedAt: NOW - DAY_MS + 600_000,
          interactionMin: 4,
          title: 'Run A',
          apps: ['Excel'],
          steps: [],
        },
        // 2-min span, 2 active
        {
          startedAt: NOW - 120_000,
          endedAt: NOW,
          interactionMin: 2,
          title: 'Run B',
          apps: ['Excel', 'Mail'],
          steps: [],
        },
      ],
      10,
      NOW,
    )
    expect(info.title).toBe('Process invoices')
    expect(info.apps.sort()).toEqual(['Excel', 'Mail'])
    expect(info.timesSeen).toBe(2)
    expect(info.timesPerWeek).toBeCloseTo(1.4)
    expect(info.avgActiveMin).toBeCloseTo(3)
    expect(info.lastSeenAt).toBe(NOW)
    expect(info.mechanism).toBe('A nightly sync.')
    expect(info.recurrence.reduce((sum, b) => sum + b.count, 0)).toBe(2)
  })

  it('excludes members older than the stats window', () => {
    const info = buildClusterInfo(
      head,
      [
        {
          startedAt: NOW - 100 * DAY_MS,
          endedAt: NOW - 100 * DAY_MS + 600_000,
          interactionMin: 4,
          title: 'Old run',
          apps: ['Excel'],
          steps: [],
        },
        {
          startedAt: NOW - DAY_MS,
          endedAt: NOW - DAY_MS + 600_000,
          interactionMin: 4,
          title: 'Recent run',
          apps: ['Mail'],
          steps: [],
        },
      ],
      10,
      NOW,
    )
    expect(info.timesSeen).toBe(1)
    expect(info.apps).toEqual(['Mail'])
  })

  it('handles a memberless cluster without stats or recurrence', () => {
    const info = buildClusterInfo({ ...head, label: '' }, [], 10, NOW)
    expect(info.title).toBe('Untitled task')
    expect(info.timesSeen).toBe(0)
    expect(info.lastSeenAt).toBeNull()
    expect(info.recurrence).toEqual([])
  })

  it('falls back to in-window member steps when the cluster has no recipe', () => {
    const info = buildClusterInfo(
      head,
      [
        member(NOW - 100 * DAY_MS, 'Run', ['App: out of window']),
        member(NOW - 2 * DAY_MS, 'Run', ['App: older']),
        member(NOW - DAY_MS, 'Run', ['App: newest']),
      ],
      10,
      NOW,
    )
    expect(info.steps).toEqual(['App: newest'])
  })
})

describe('computeClustersView (real storage)', () => {
  const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_cluster_view_test.db')
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

  const addSighting = (id: string, startedAt: number, steps: string[]) =>
    storage.sightings.add({
      id,
      title: 'Run the batch',
      subject: '',
      description: 'd',
      steps,
      apps: ['App'],
      activityIds: ['a1'],
      startedAt,
      endedAt: startedAt + 60_000,
      interactionMin: 5,
      runId: 'r1',
      detectedAt: startedAt,
    })

  const addCluster = (id: string, label: string) =>
    storage.clusters.create({
      id,
      label,
      description: '',
      centroid: null,
      mechanism: '',
      steps: [],
      variables: [],
      labeledSize: 0,
      createdAt: 1000,
    })

  it('serves the stored recipe in the list view, with member fallback when absent', () => {
    const now = Date.now()
    addSighting('s1', now - DAY_MS, ['App: raw run one'])
    addSighting('s2', now - 2 * DAY_MS, ['App: raw run two'])
    addSighting('s3', now - DAY_MS, ['App: other raw'])
    addSighting('s4', now - 2 * DAY_MS, [])

    addCluster('with-recipe', 'Labeled process')
    storage.clusters.addMembership('with-recipe', 's1')
    storage.clusters.addMembership('with-recipe', 's2')
    storage.clusters.updateRecipe('with-recipe', {
      steps: ['App: generalized step'],
      variables: ['customer name'],
    })

    addCluster('no-recipe', 'Other process')
    storage.clusters.addMembership('no-recipe', 's3')
    storage.clusters.addMembership('no-recipe', 's4')

    const { clusters } = computeClustersView(storage, now)
    const withRecipe = clusters.find((c) => c.id === 'with-recipe')!
    const noRecipe = clusters.find((c) => c.id === 'no-recipe')!

    expect(withRecipe.steps).toEqual(['App: generalized step'])
    expect(withRecipe.variables).toEqual(['customer name'])
    expect(noRecipe.steps).toEqual(['App: other raw'])
  })
})
