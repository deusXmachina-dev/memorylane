import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivityFrame } from './activity-types'
import { detectTrailingLeakFrames } from './boundary-trim'

const { nullLuminance, diffs } = vi.hoisted(() => ({
  nullLuminance: new Set<string>(),
  diffs: new Map<string, number>(),
}))

// Luminance profile = the filepath itself; L1 difference comes from a
// per-test pair table. Unknown pairs default to 50/50 (equidistant => kept).
vi.mock('./semantic/visual-diff', () => ({
  loadImageLuminance: vi.fn(async (filepath: string) => {
    return nullLuminance.has(filepath) ? null : filepath
  }),
  luminanceL1DifferencePercent: vi.fn((left: string, right: string) => {
    if (left === right) return 0
    const pair = [left, right].sort().join('|')
    return diffs.get(pair) ?? 50
  }),
}))

function setDiff(left: string, right: string, value: number): void {
  diffs.set([left, right].sort().join('|'), value)
}

function makeFrame(filepath: string, sequenceNumber: number): ActivityFrame {
  return {
    offset: sequenceNumber,
    frame: {
      filepath,
      timestamp: 1_000 + sequenceNumber * 1_000,
      width: 1280,
      height: 720,
      displayId: 1,
      sequenceNumber,
    },
  }
}

function filepaths(frames: ActivityFrame[]): string[] {
  return frames.map((f) => f.frame.filepath)
}

describe('detectTrailingLeakFrames', () => {
  afterEach(() => {
    nullLuminance.clear()
    diffs.clear()
  })

  it('drops a contiguous tail that is closer to the after-boundary frames than to its own activity', async () => {
    // candidates a3-a5, own references a1-a2
    const frames = ['a1', 'a2', 'a3', 'a4', 'a5'].map(makeFrame)
    const afterFrames = [makeFrame('g1', 10), makeFrame('g2', 11)]
    setDiff('a5', 'g1', 5)
    setDiff('a5', 'a2', 30)
    setDiff('a4', 'g2', 10)
    setDiff('a4', 'a1', 25)
    setDiff('a3', 'g1', 40)
    setDiff('a3', 'a2', 5)

    const result = await detectTrailingLeakFrames({ frames, afterFrames })

    expect(filepaths(result.framesToDrop)).toEqual(['a4', 'a5'])
  })

  it('stops at the first candidate that is closer to its own activity', async () => {
    const frames = ['a1', 'a2', 'a3', 'a4', 'a5'].map(makeFrame)
    const afterFrames = [makeFrame('g1', 10)]
    setDiff('a5', 'g1', 5)
    setDiff('a5', 'a1', 40)
    setDiff('a4', 'g1', 40)
    setDiff('a4', 'a1', 5)
    setDiff('a3', 'g1', 5)
    setDiff('a3', 'a1', 40)

    const result = await detectTrailingLeakFrames({ frames, afterFrames })

    expect(filepaths(result.framesToDrop)).toEqual(['a5'])
  })

  it('keeps an equidistant candidate (ties are not leaks)', async () => {
    const frames = ['a1', 'a2', 'a3'].map(makeFrame)
    const afterFrames = [makeFrame('g1', 10)]
    setDiff('a3', 'g1', 20)
    setDiff('a3', 'a1', 20)

    const result = await detectTrailingLeakFrames({ frames, afterFrames })

    expect(result.framesToDrop).toEqual([])
  })

  it('keeps a candidate whose margin is below the evidence threshold', async () => {
    const frames = ['a1', 'a2', 'a3'].map(makeFrame)
    const afterFrames = [makeFrame('g1', 10)]
    // 0.3 closer to the after side, but not by enough
    // (MIN_LEAK_MARGIN_PERCENT = 0.5).
    setDiff('a3', 'g1', 20)
    setDiff('a3', 'a1', 20.3)

    const result = await detectTrailingLeakFrames({ frames, afterFrames })

    expect(result.framesToDrop).toEqual([])
  })

  it('uses the closest reference on each side', async () => {
    const frames = ['a1', 'a2', 'a3'].map(makeFrame)
    const afterFrames = [makeFrame('g1', 10), makeFrame('g2', 11)]
    // far from g1 but close to g2; own side stays far
    setDiff('a3', 'g1', 45)
    setDiff('a3', 'g2', 5)
    setDiff('a3', 'a1', 40)

    const result = await detectTrailingLeakFrames({ frames, afterFrames })

    expect(filepaths(result.framesToDrop)).toEqual(['a3'])
  })

  it('never empties the activity even when every frame matches the after side', async () => {
    const frames = ['a1', 'a2'].map(makeFrame)
    const afterFrames = [makeFrame('g1', 10)]
    setDiff('a2', 'g1', 0)
    setDiff('a2', 'a1', 40)
    setDiff('a1', 'g1', 0)

    const result = await detectTrailingLeakFrames({ frames, afterFrames })

    expect(filepaths(result.framesToDrop)).toEqual(['a2'])
  })

  it('keeps a frame whose luminance cannot be loaded', async () => {
    const frames = ['a1', 'a2', 'a3'].map(makeFrame)
    const afterFrames = [makeFrame('g1', 10)]
    nullLuminance.add('a3')
    setDiff('a3', 'g1', 0)

    const result = await detectTrailingLeakFrames({ frames, afterFrames })

    expect(result.framesToDrop).toEqual([])
  })

  it('trims nothing when no after-reference can be loaded', async () => {
    const frames = ['a1', 'a2', 'a3'].map(makeFrame)
    const afterFrames = [makeFrame('g1', 10), makeFrame('g2', 11)]
    nullLuminance.add('g1')
    nullLuminance.add('g2')
    setDiff('a3', 'g1', 0)

    const result = await detectTrailingLeakFrames({ frames, afterFrames })

    expect(result.framesToDrop).toEqual([])
  })

  it('trims nothing without after-boundary frames', async () => {
    const frames = ['a1', 'a2', 'a3', 'a4', 'a5'].map(makeFrame)
    setDiff('a5', 'a2', 90)

    const result = await detectTrailingLeakFrames({ frames, afterFrames: [] })

    expect(result.framesToDrop).toEqual([])
  })

  it('does nothing for activities with one or zero frames', async () => {
    const single = await detectTrailingLeakFrames({
      frames: [makeFrame('a1', 0)],
      afterFrames: [makeFrame('g1', 10)],
    })
    expect(single.framesToDrop).toEqual([])

    const empty = await detectTrailingLeakFrames({
      frames: [],
      afterFrames: [makeFrame('g1', 10)],
    })
    expect(empty.framesToDrop).toEqual([])
  })
})
