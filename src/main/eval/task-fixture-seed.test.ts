import { describe, expect, it } from 'vitest'
import { renderTaskFixtureGoldenMd } from './task-fixture-build'
import {
  layoutSeedDay,
  seedNoise,
  seedToRuns,
  validateTaskSeed,
  type TaskSeed,
} from './task-fixture-seed'
import { parseTaskGoldenMd } from './task-golden-md'

const step = (summary: string, durationMin = 1) => ({ app: 'Google Chrome', summary, durationMin })

function makeSeed(): TaskSeed {
  return {
    slug: 'pkg',
    day: '2026-09-15',
    startMin: 510,
    tasks: [
      {
        title: 'Samples',
        runs: [
          { description: 'run a', steps: [step('a1'), step('a2', 2), step('a3')] },
          { description: 'run b', steps: [step('b1'), step('b2')] },
        ],
      },
      { title: 'Decoy', verdict: 'reject', runs: [{ steps: [step('d1'), step('d2')] }] },
    ],
    noise: Array.from({ length: 8 }, (_, i) => step(`n${i + 1}`)),
  }
}

describe('seedToRuns', () => {
  it('mints ids, interleaves runs round-robin and tags titles and verdicts', () => {
    const runs = seedToRuns(makeSeed())
    expect(runs.map((r) => r.block.title)).toEqual(['Samples (1/2)', 'Decoy', 'Samples (2/2)'])
    expect(runs[0].block.activityIds).toEqual(['pkg-t1-r1-01', 'pkg-t1-r1-02', 'pkg-t1-r1-03'])
    expect(runs[1].block.verdict).toBe('reject')
    expect(runs[2].block.description).toBe('run b')
  })
})

describe('layoutSeedDay', () => {
  const seed = makeSeed()
  const runs = seedToRuns(seed)
  const noise = seedNoise(seed)

  it('contiguous keeps each run unbroken and the day back-to-back', () => {
    const day = layoutSeedDay(runs, noise, 'contiguous', seed.startMin)
    expect(day).toHaveLength(noise.length + 7)
    expect(day[0].offsetMin).toBe(510)
    for (let i = 1; i < day.length; i++) {
      expect(day[i].offsetMin).toBe(day[i - 1].offsetMin + day[i - 1].durationMin)
    }
    const ids = day.map((a) => a.id)
    const first = ids.indexOf('pkg-t1-r1-01')
    expect(ids.slice(first, first + 3)).toEqual(runs[0].block.activityIds)
  })

  it('multitask puts noise between consecutive steps', () => {
    const day = layoutSeedDay(runs, noise, 'multitask', seed.startMin)
    const ids = day.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    const a1 = ids.indexOf('pkg-t1-r1-01')
    const a2 = ids.indexOf('pkg-t1-r1-02')
    expect(a2 - a1).toBeGreaterThan(1)
  })
})

describe('validateTaskSeed', () => {
  it('rejects a step without a positive integer duration', () => {
    const seed = makeSeed()
    seed.noise[0] = step('bad', 0)
    expect(() => validateTaskSeed(seed)).toThrow(/durationMin/)
  })
})

describe('rendered seed golden', () => {
  it('round-trips reject verdicts', () => {
    const seed = makeSeed()
    const runs = seedToRuns(seed)
    const md = renderTaskFixtureGoldenMd(
      'pkg',
      runs.map((r) => r.block),
      layoutSeedDay(runs, seedNoise(seed), 'contiguous', seed.startMin),
    )
    expect(parseTaskGoldenMd(md).sightings.map((s) => s.verdict)).toEqual([
      'keep',
      'reject',
      'keep',
    ])
  })
})
