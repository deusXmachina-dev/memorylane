import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { StorageService } from '../storage'
import { applyMigrations } from '../storage/migrator'
import { createStoredActivity, deleteDbFiles } from '../storage/test-utils'
import {
  applyParaphrasedSummaries,
  buildWindowedActivities,
  cloneOccurrence,
  fixtureName,
  largestGapOffset,
  placeOccurrences,
  placeTask,
  renderSightingGoldenMd,
  renderTaskFixtureGoldenMd,
  semanticGoldenToTask,
  type SemanticTaskResult,
} from './task-fixture-build'
import { parseTaskGoldenMd } from './task-golden-md'
import type { GoldenActivity } from './golden-md'
import type { TaskFixtureActivity } from './task-types'

const DB_PATH = path.join(os.tmpdir(), 'task-fixture-build-test.db')
const MIN = 60_000
// Local midnight June 10 2026 — deterministic regardless of timezone.
const DAY = new Date(2026, 5, 10).getTime()

let storage: StorageService

function addAt(id: string, offsetMin: number, durationMin = 5): void {
  storage.activities.add(
    createStoredActivity({
      id,
      startTimestamp: DAY + offsetMin * MIN,
      endTimestamp: DAY + (offsetMin + durationMin) * MIN,
      ocrText: `ocr-${id}`,
    }),
  )
}

beforeEach(() => {
  deleteDbFiles(DB_PATH)
  storage = new StorageService(DB_PATH)
  applyMigrations(storage.getDatabase())
})

afterEach(() => {
  storage.close()
  deleteDbFiles(DB_PATH)
})

describe('buildWindowedActivities', () => {
  it('includes only activities inside the padded window', () => {
    addAt('before-far', 7 * 60) // 07:00 — outside ±1h
    addAt('before-near', 8 * 60 + 40) // 08:40 — inside
    addAt('s1', 9 * 60) // 09:00 — sighting
    addAt('s2', 9 * 60 + 20, 10) // 09:20–09:30 — sighting
    addAt('after-near', 9 * 60 + 50) // 09:50 — inside
    addAt('after-far', 11 * 60) // 11:00 — outside

    const { activities, dayStart } = buildWindowedActivities(storage, ['s1', 's2'], 60, 60)
    expect(activities.map((a) => a.id)).toEqual(['before-near', 's1', 's2', 'after-near'])
    expect(dayStart).toBe(DAY)
    // offsetMin is relative to local midnight; OCR is rehydrated.
    expect(activities.find((a) => a.id === 's1')?.offsetMin).toBe(540)
    expect(activities.find((a) => a.id === 's1')?.ocrText).toBe('ocr-s1')
  })

  it('throws when the sighting has no resolvable activities', () => {
    expect(() => buildWindowedActivities(storage, ['ghost'], 60, 60)).toThrow()
  })
})

describe('renderSightingGoldenMd', () => {
  it('round-trips a keep block through parseTaskGoldenMd', () => {
    const md = renderSightingGoldenMd(
      'my-golden',
      {
        title: 'Submit expense report',
        apps: ['Chrome', 'Preview'],
        activityIds: ['s1', 's2'],
        description: 'Filled the Concur form and submitted.',
      },
      [
        {
          id: 's1',
          offsetMin: 540,
          durationMin: 5,
          app: 'Chrome',
          windowTitle: 'Concur',
          tld: null,
          summary: 'opened form',
          ocrText: '',
        },
      ],
    )

    const parsed = parseTaskGoldenMd(md)
    expect(parsed.sightings).toHaveLength(1)
    const s = parsed.sightings[0]
    expect(s.title).toBe('Submit expense report')
    expect(s.verdict).toBe('keep')
    expect(s.apps).toEqual(['Chrome', 'Preview'])
    expect(s.activityIds).toEqual(['s1', 's2'])
    expect(s.description).toContain('Filled the Concur form')
  })
})

// --- pure helpers (no DB) ---------------------------------------------------

function golden(
  partial: Partial<GoldenActivity> & { startOffsetMs: number; endOffsetMs: number },
): GoldenActivity {
  return { index: 1, appName: 'Google Chrome', summary: 's', ...partial }
}

function noiseAt(offsetMin: number, durationMin = 2): TaskFixtureActivity {
  return {
    id: `n-${offsetMin}`,
    offsetMin,
    durationMin,
    app: 'Code',
    windowTitle: '',
    tld: null,
    summary: 'noise',
    ocrText: '',
  }
}

describe('semanticGoldenToTask', () => {
  it('drops DROPPED blocks, mints ids, lays activities back-to-back', () => {
    const { activities, block } = semanticGoldenToTask({
      idPrefix: 'jaro-2026-06-19',
      title: 'Contract setup',
      description: 'Did the thing.',
      goldens: [
        golden({ startOffsetMs: 0, endOffsetMs: 60_000, tld: 'drive.google.com', summary: 'a' }),
        golden({ startOffsetMs: 60_000, endOffsetMs: 70_000, dropped: true, summary: 'DROPPED' }),
        golden({
          startOffsetMs: 70_000,
          endOffsetMs: 190_000,
          appName: 'Google Docs',
          summary: 'b',
        }),
      ],
    })

    expect(activities.map((a) => a.id)).toEqual(['jaro-2026-06-19-01', 'jaro-2026-06-19-02'])
    expect(activities.map((a) => a.offsetMin)).toEqual([0, 1]) // back-to-back
    expect(activities.map((a) => a.durationMin)).toEqual([1, 2])
    expect(activities.every((a) => a.ocrText === '')).toBe(true)
    expect(activities[0].tld).toBe('drive.google.com')
    expect(block.activityIds).toEqual(['jaro-2026-06-19-01', 'jaro-2026-06-19-02'])
    expect(block.apps).toEqual(['Google Chrome', 'Google Docs'])
    expect(block.title).toBe('Contract setup')
  })

  it('keepExclude leaves an id out of the keep block but keeps it as a day activity', () => {
    const { activities, block } = semanticGoldenToTask({
      idPrefix: 'jaro',
      title: 'T',
      description: 'd',
      keepExclude: [1], // drop the recorder-start opener
      goldens: [
        golden({
          startOffsetMs: 0,
          endOffsetMs: 60_000,
          appName: 'MemoryLane',
          summary: 'opened settings',
        }),
        golden({
          startOffsetMs: 60_000,
          endOffsetMs: 120_000,
          appName: 'Google Chrome',
          summary: 'a',
        }),
        golden({
          startOffsetMs: 120_000,
          endOffsetMs: 180_000,
          appName: 'Google Chrome',
          summary: 'b',
        }),
      ],
    })

    // all three are day activities…
    expect(activities.map((a) => a.id)).toEqual(['jaro-01', 'jaro-02', 'jaro-03'])
    // …but the keep block excludes #1 (and so MemoryLane drops out of apps).
    expect(block.activityIds).toEqual(['jaro-02', 'jaro-03'])
    expect(block.apps).toEqual(['Google Chrome'])
  })

  it('throws when every block is dropped', () => {
    expect(() =>
      semanticGoldenToTask({
        idPrefix: 'x',
        title: 't',
        description: 'd',
        goldens: [
          golden({ startOffsetMs: 0, endOffsetMs: 1000, dropped: true, summary: 'DROPPED' }),
        ],
      }),
    ).toThrow()
  })
})

describe('largestGapOffset', () => {
  it('returns the start of the largest fitting gap', () => {
    const noise = [noiseAt(60, 5), noiseAt(120, 5), noiseAt(600, 5)]
    expect(largestGapOffset(noise, 10, 999)).toBe(126) // 120+5 end, +1
  })

  it('falls back when no gap fits or there is no noise', () => {
    expect(largestGapOffset([noiseAt(0, 5)], 10, 583)).toBe(583)
    expect(largestGapOffset([], 10, 583)).toBe(583)
  })

  it('rejects a gap that only equals the span (needs a 1-min buffer so it cannot overlap)', () => {
    // gap = 20 − (0+5) = 15, exactly the span → must NOT fit (would overlap by 1).
    expect(largestGapOffset([noiseAt(0, 5), noiseAt(20, 5)], 15, 999)).toBe(999)
    // one more minute of room and it fits, starting right after the first activity.
    expect(largestGapOffset([noiseAt(0, 5), noiseAt(21, 5)], 15, 999)).toBe(6)
  })
})

describe('placeTask', () => {
  const task = semanticGoldenToTask({
    idPrefix: 't',
    title: 'T',
    description: 'd',
    goldens: [
      golden({ startOffsetMs: 0, endOffsetMs: 60_000, summary: 'a' }),
      golden({ startOffsetMs: 60_000, endOffsetMs: 120_000, summary: 'b' }),
      golden({ startOffsetMs: 120_000, endOffsetMs: 180_000, summary: 'c' }),
    ],
  }).activities // offsets [0,1,2], durations [1,1,1]

  it('contiguous: packs the task into the largest gap, preserving spacing', () => {
    const noise = [noiseAt(60, 5), noiseAt(600, 5)] // big gap 65 → 600
    const placed = placeTask(task, noise, 'contiguous', { fallbackOffsetMin: 999 })
    expect(placed.map((a) => a.offsetMin)).toEqual([66, 67, 68])
  })

  it('multitask: weaves the task through noise so unrelated activities sit between steps', () => {
    const noise = Array.from({ length: 13 }, (_, i) => noiseAt(300 + i * 5, 1))
    const placed = placeTask(task, noise, 'multitask', { interruptions: 2 })
    const offsets = placed.map((a) => a.offsetMin)
    // strictly increasing
    expect(offsets.every((o, i) => i === 0 || o > offsets[i - 1])).toBe(true)
    // each consecutive pair of task steps has >=1 noise activity strictly between
    for (let i = 1; i < offsets.length; i++) {
      const between = noise.filter(
        (nn) => nn.offsetMin > offsets[i - 1] && nn.offsetMin < offsets[i],
      )
      expect(between.length).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('placeTask multitask — sparse noise', () => {
  const task = semanticGoldenToTask({
    idPrefix: 't',
    title: 'T',
    description: 'd',
    goldens: [
      golden({ startOffsetMs: 0, endOffsetMs: 60_000, summary: 'a' }),
      golden({ startOffsetMs: 60_000, endOffsetMs: 120_000, summary: 'b' }),
      golden({ startOffsetMs: 120_000, endOffsetMs: 180_000, summary: 'c' }),
    ],
  }).activities // 3 steps

  it('reduces interruptions (with a warning) and keeps a gap between every step', () => {
    const noise = Array.from({ length: 6 }, (_, i) => noiseAt(300 + i * 5, 1))
    const warnings: string[] = []
    const placed = placeTask(task, noise, 'multitask', {
      interruptions: 3,
      onWarn: (m) => warnings.push(m),
    })
    const offsets = placed.map((a) => a.offsetMin)
    // anchors stay distinct — no two steps collapse onto the same minute
    expect(offsets.every((o, i) => i === 0 || o > offsets[i - 1])).toBe(true)
    expect(warnings.some((w) => /reduced interruptions 3/.test(w))).toBe(true)
    // after the reduction there is still ≥1 noise activity between consecutive steps
    for (let i = 1; i < offsets.length; i++) {
      const between = noise.filter(
        (nn) => nn.offsetMin > offsets[i - 1] && nn.offsetMin < offsets[i],
      )
      expect(between.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('warns and does not collapse steps when there is less noise than steps', () => {
    const noise = [noiseAt(100, 1), noiseAt(105, 1)] // 2 noise, 3 steps
    const warnings: string[] = []
    const placed = placeTask(task, noise, 'multitask', {
      interruptions: 2,
      onWarn: (m) => warnings.push(m),
    })
    const offsets = placed.map((a) => a.offsetMin)
    expect(new Set(offsets).size).toBe(offsets.length) // all distinct
    expect(offsets.every((o, i) => i === 0 || o > offsets[i - 1])).toBe(true)
    expect(warnings.length).toBeGreaterThan(0)
  })
})

describe('placeTask contiguous — bounds', () => {
  const task = semanticGoldenToTask({
    idPrefix: 't',
    title: 'T',
    description: 'd',
    goldens: [
      golden({ startOffsetMs: 0, endOffsetMs: 60_000, summary: 'a' }),
      golden({ startOffsetMs: 60_000, endOffsetMs: 120_000, summary: 'b' }),
      golden({ startOffsetMs: 120_000, endOffsetMs: 180_000, summary: 'c' }),
    ],
  }).activities // span 3

  it('never runs past end-of-day (no stacking on the final minute)', () => {
    // Only space is just before a late single activity → edge fallback, clamped.
    const noise = [noiseAt(1435, 5)]
    const placed = placeTask(task, noise, 'contiguous', {})
    const offsets = placed.map((a) => a.offsetMin)
    expect(Math.max(...offsets)).toBeLessThanOrEqual(24 * 60 - 1)
    expect(new Set(offsets).size).toBe(offsets.length) // distinct, not clamped together
    // internal back-to-back spacing preserved
    expect(offsets[1] - offsets[0]).toBe(1)
    expect(offsets[2] - offsets[1]).toBe(1)
  })
})

// --- recurring tasks --------------------------------------------------------

function baseTask(): SemanticTaskResult {
  return semanticGoldenToTask({
    idPrefix: 'jaro',
    title: 'Contract setup',
    description: 'Did the thing.',
    goldens: [
      golden({ startOffsetMs: 0, endOffsetMs: 60_000, appName: 'Drive', summary: 'create folder' }),
      golden({
        startOffsetMs: 60_000,
        endOffsetMs: 120_000,
        appName: 'Docs',
        summary: 'copy agreement',
      }),
      golden({
        startOffsetMs: 120_000,
        endOffsetMs: 180_000,
        appName: 'Docs',
        summary: 'fill terms',
      }),
    ],
  })
}

describe('cloneOccurrence', () => {
  it('total=1: keeps base ids and title (no suffix, no reorder)', () => {
    const o = cloneOccurrence(baseTask(), { index: 1, total: 1, reorder: true })
    expect(o.activities.map((a) => a.id)).toEqual(['jaro-01', 'jaro-02', 'jaro-03'])
    expect(o.block.title).toBe('Contract setup')
    expect(o.block.activityIds).toEqual(['jaro-01', 'jaro-02', 'jaro-03'])
  })

  it('total>1: suffixes ids, tags the title, reorders later occurrences', () => {
    const o1 = cloneOccurrence(baseTask(), { index: 1, total: 3, reorder: true })
    const o2 = cloneOccurrence(baseTask(), { index: 2, total: 3, reorder: true })

    expect(o1.activities.map((a) => a.id)).toEqual(['jaro-01-o1', 'jaro-02-o1', 'jaro-03-o1'])
    expect(o1.block.title).toBe('Contract setup (1/3)')
    // occurrence 1 keeps order; occurrence 2 swaps the second pair (pos 1<->2).
    expect(o2.activities.map((a) => a.id)).toEqual(['jaro-01-o2', 'jaro-03-o2', 'jaro-02-o2'])
    expect(o2.block.title).toBe('Contract setup (2/3)')
    expect(o2.activities.map((a) => a.offsetMin)).toEqual([0, 1, 2]) // re-laid back-to-back

    // ids are disjoint across occurrences (fixture-unique)
    const ids1 = new Set(o1.activities.map((a) => a.id))
    expect(o2.activities.every((a) => !ids1.has(a.id))).toBe(true)
  })
})

describe('applyParaphrasedSummaries', () => {
  it('swaps summaries by index, keeps ids/offsets/block', () => {
    const o = cloneOccurrence(baseTask(), { index: 1, total: 1 })
    const out = applyParaphrasedSummaries(o, ['A', '', 'C']) // empty keeps the original
    expect(out.activities.map((a) => a.summary)).toEqual(['A', 'copy agreement', 'C'])
    expect(out.activities.map((a) => a.id)).toEqual(o.activities.map((a) => a.id))
    expect(out.block).toBe(o.block)
  })
})

describe('placeOccurrences', () => {
  it('places each occurrence in its own slice of noise; ids stay unique', () => {
    const occ = [1, 2, 3].map((k) =>
      cloneOccurrence(baseTask(), { index: k, total: 3, reorder: true }),
    )
    const noise = Array.from({ length: 12 }, (_, i) => noiseAt(60 + i * 60, 5))
    const { placed, warnings } = placeOccurrences(
      occ.map((o) => o.activities),
      noise,
      'contiguous',
      {},
    )
    expect(placed).toHaveLength(3)
    const range = (p: TaskFixtureActivity[]): { min: number; max: number } => ({
      min: Math.min(...p.map((a) => a.offsetMin)),
      max: Math.max(...p.map((a) => a.offsetMin)),
    })
    const r = placed.map(range)
    expect(r[0].max).toBeLessThan(r[1].min) // temporally separated
    expect(r[1].max).toBeLessThan(r[2].min)
    const allIds = placed.flat().map((a) => a.id)
    expect(new Set(allIds).size).toBe(allIds.length)
    expect(warnings).toEqual([])
  })

  it('warns when there is less noise than occurrences', () => {
    const occ = [1, 2, 3].map((k) => cloneOccurrence(baseTask(), { index: k, total: 3 }))
    const noise = [noiseAt(60, 5), noiseAt(600, 5)] // 2 noise, 3 occurrences
    const { placed, warnings } = placeOccurrences(
      occ.map((o) => o.activities),
      noise,
      'contiguous',
      {},
    )
    expect(placed).toHaveLength(3)
    expect(warnings.some((w) => /won't be separated/.test(w))).toBe(true)
  })
})

describe('renderTaskFixtureGoldenMd', () => {
  it('renders N keep blocks that round-trip to N sightings', () => {
    const blocks = [
      {
        title: 'T (1/2)',
        apps: ['Drive'],
        activityIds: ['jaro-01-o1', 'jaro-02-o1'],
        description: 'd1',
      },
      {
        title: 'T (2/2)',
        apps: ['Docs'],
        activityIds: ['jaro-01-o2', 'jaro-02-o2'],
        description: 'd2',
      },
    ]
    const md = renderTaskFixtureGoldenMd('rec', blocks, [noiseAt(10)])
    const parsed = parseTaskGoldenMd(md)
    expect(parsed.sightings).toHaveLength(2)
    expect(parsed.sightings.map((s) => s.verdict)).toEqual(['keep', 'keep'])
    expect(parsed.sightings[0].activityIds).toEqual(['jaro-01-o1', 'jaro-02-o1'])
    expect(parsed.sightings[1].title).toBe('T (2/2)')
  })
})

describe('fixtureName', () => {
  it('keeps existing names for deterministic variants', () => {
    expect(fixtureName('2026-06-10', 'jaro-contract', 'contiguous', 1, 'none')).toBe(
      '2026-06-10-jaro-contract',
    )
    expect(fixtureName('2026-06-10', 'jaro-contract', 'multitask', 1, 'none')).toBe(
      '2026-06-10-jaro-contract-multitask',
    )
    // reorder stays unmarked so the existing x3 fixtures don't get renamed
    expect(fixtureName('2026-06-10', 'jaro-contract', 'multitask', 3, 'reorder')).toBe(
      '2026-06-10-jaro-contract-multitask-x3',
    )
  })

  it('tags llm variants so they do not collide with reorder', () => {
    expect(fixtureName('2026-06-10', 'jaro-contract', 'contiguous', 3, 'llm')).toBe(
      '2026-06-10-jaro-contract-x3-llm',
    )
    expect(fixtureName('2026-06-10', 'jaro-contract', 'multitask', 3, 'llm')).toBe(
      '2026-06-10-jaro-contract-multitask-x3-llm',
    )
  })

  it('respects the slug', () => {
    expect(fixtureName('2026-06-10', 'petr-admin', 'contiguous', 1, 'none')).toBe(
      '2026-06-10-petr-admin',
    )
  })
})
