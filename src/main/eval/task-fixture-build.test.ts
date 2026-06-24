import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { StorageService } from '../storage'
import { applyMigrations } from '../storage/migrator'
import { createStoredActivity, deleteDbFiles } from '../storage/test-utils'
import {
  buildWindowedActivities,
  largestGapOffset,
  placeTask,
  renderSightingGoldenMd,
  semanticGoldenToTask,
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
