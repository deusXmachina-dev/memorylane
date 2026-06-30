import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanupActivityFiles } from './activity-cleanup'
import type { Activity } from './activity-types'
import log from '@main/utils/logger'

vi.mock('@main/utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

function makeActivity(id: string, framePaths: string[]): Activity {
  return {
    id,
    startTimestamp: 1000,
    endTimestamp: 2000,
    context: {
      appName: 'Test',
      bundleId: 'com.test',
      windowTitle: 'Test Window',
      tld: undefined,
    },
    interactions: [],
    frames: framePaths.map((filepath, i) => ({
      offset: i,
      frame: {
        filepath,
        timestamp: 1000 + i * 100,
        width: 1920,
        height: 1080,
        displayId: 1,
        sequenceNumber: i,
      },
    })),
    provenance: {
      eventWindowOffsets: [],
      frameOffsets: [],
      sourceWindowIds: [],
      sourceClosedBy: [],
    },
  }
}

describe('cleanupActivityFiles', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-test-'))
    vi.clearAllMocks()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('deletes frame PNGs and video MP4', () => {
    const frame0 = path.join(tmpDir, 'frame-0.png')
    const frame1 = path.join(tmpDir, 'frame-1.png')
    const video = path.join(tmpDir, 'act-1.mp4')

    fs.writeFileSync(frame0, 'png0')
    fs.writeFileSync(frame1, 'png1')
    fs.writeFileSync(video, 'mp4')

    const activity = makeActivity('act-1', [frame0, frame1])
    cleanupActivityFiles(activity, tmpDir)

    expect(fs.existsSync(frame0)).toBe(false)
    expect(fs.existsSync(frame1)).toBe(false)
    expect(fs.existsSync(video)).toBe(false)
  })

  it('tolerates missing files gracefully', () => {
    const activity = makeActivity('missing-act', [
      path.join(tmpDir, 'nonexistent-0.png'),
      path.join(tmpDir, 'nonexistent-1.png'),
    ])

    expect(() => cleanupActivityFiles(activity, tmpDir)).not.toThrow()
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('with zero frames is a no-op', () => {
    const activity = makeActivity('empty-act', [])

    expect(() => cleanupActivityFiles(activity, tmpDir)).not.toThrow()
  })
})
