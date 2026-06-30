import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivityFrame } from '@main/activity/activity-types'
import { selectSnapshotFrames } from './sampling'

vi.mock('./visual-diff', () => ({
  loadImageDHash: vi.fn(async (filepath: string) => {
    const normalized = filepath.replaceAll('\\', '/')
    return normalized.slice(normalized.lastIndexOf('/') + 1)
  }),
  dHashDifferencePercent: vi.fn((leftHash: string, rightHash: string) => {
    if (leftHash === rightHash) return 0
    const pair = [leftHash, rightHash].sort().join('|')
    if (pair === 'f0.png|f1.png') return 20
    if (pair === 'f1.png|f2.png') return 1
    return 50
  }),
}))

function makeFrame(filepath: string, timestamp: number, sequenceNumber: number): ActivityFrame {
  return {
    offset: sequenceNumber,
    frame: {
      filepath,
      timestamp,
      width: 1280,
      height: 720,
      displayId: 1,
      sequenceNumber,
    },
  }
}

describe('selectSnapshotFrames anchor directionality', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  function createImageFile(dir: string, name: string): string {
    const filepath = path.join(dir, name)
    fs.writeFileSync(filepath, 'fake-image')
    return filepath
  }

  it('chooses start anchor frame at-or-after timestamp (never in past)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sampling-direction-test-'))
    tempDirs.push(dir)

    const frames = [
      makeFrame(createImageFile(dir, 'f0.png'), 90, 0),
      makeFrame(createImageFile(dir, 'f1.png'), 110, 1),
      makeFrame(createImageFile(dir, 'f2.png'), 130, 2),
    ]

    const selected = await selectSnapshotFrames({
      frames,
      maxSnapshots: 10,
      startAnchorTimestamp: 100,
      visualThresholdPercent: 0,
    })

    expect(selected.map((frame) => path.basename(frame.frame.filepath))).toEqual([
      'f1.png',
      'f2.png',
    ])
  })

  it('chooses end anchor frame at-or-before timestamp (never in future)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sampling-direction-test-'))
    tempDirs.push(dir)

    const frames = [
      makeFrame(createImageFile(dir, 'f0.png'), 100, 0),
      makeFrame(createImageFile(dir, 'f1.png'), 120, 1),
      makeFrame(createImageFile(dir, 'f2.png'), 140, 2),
    ]

    const selected = await selectSnapshotFrames({
      frames,
      maxSnapshots: 10,
      endAnchorTimestamp: 130,
      visualThresholdPercent: 0,
    })

    expect(selected.map((frame) => path.basename(frame.frame.filepath))).toEqual([
      'f0.png',
      'f1.png',
    ])
  })

  it('with explicit start/end anchors excludes stale pre-start and post-end frames', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sampling-direction-test-'))
    tempDirs.push(dir)

    const frames = [
      makeFrame(createImageFile(dir, 'f0.png'), 90, 0),
      makeFrame(createImageFile(dir, 'f1.png'), 110, 1),
      makeFrame(createImageFile(dir, 'f2.png'), 130, 2),
      makeFrame(createImageFile(dir, 'f3.png'), 150, 3),
    ]

    const selected = await selectSnapshotFrames({
      frames,
      maxSnapshots: 10,
      startAnchorTimestamp: 100,
      endAnchorTimestamp: 140,
      visualThresholdPercent: 0,
    })

    expect(selected.map((frame) => path.basename(frame.frame.filepath))).toEqual([
      'f1.png',
      'f2.png',
    ])
  })

  it('drops penultimate frame when it is near-identical to the final frame', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sampling-tail-dedupe-test-'))
    tempDirs.push(dir)

    const frames = [
      makeFrame(createImageFile(dir, 'f0.png'), 1_000, 0),
      makeFrame(createImageFile(dir, 'f1.png'), 2_000, 1),
      makeFrame(createImageFile(dir, 'f2.png'), 3_000, 2),
    ]

    const selected = await selectSnapshotFrames({
      frames,
      maxSnapshots: 10,
      interactionAnchorTimestamps: [2_000],
      visualThresholdPercent: 8,
    })

    expect(selected.map((frame) => path.basename(frame.frame.filepath))).toEqual([
      'f0.png',
      'f2.png',
    ])
  })
})
