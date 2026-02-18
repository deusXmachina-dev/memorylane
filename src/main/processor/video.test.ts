import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ActivityScreenshot } from '../../shared/types'

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}))

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}))

vi.mock('ffmpeg-static', () => ({
  default: '/mock/ffmpeg',
}))

vi.mock('electron', () => ({
  app: { isPackaged: false },
}))

function createScreenshot(filepath: string, timestamp: number): ActivityScreenshot {
  return {
    id: `ss-${timestamp}`,
    filepath,
    timestamp,
    trigger: 'periodic',
    display: { id: 1, width: 1920, height: 1080 },
  }
}

describe('buildActivityVideo', () => {
  beforeEach(() => {
    vi.resetModules()
    mockSpawn.mockReset()
  })

  it('should build an mp4 using timestamp-ordered screenshots', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memorylane-video-'))
    const newer = path.join(tmpDir, 'newer.png')
    const older = path.join(tmpDir, 'older.png')
    fs.writeFileSync(newer, Buffer.from('newer'))
    fs.writeFileSync(older, Buffer.from('older'))

    let capturedManifest = ''
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      const proc = new EventEmitter() as EventEmitter & {
        stderr: EventEmitter
        kill: (signal?: string) => void
      }
      proc.stderr = new EventEmitter()
      proc.kill = vi.fn()

      const manifestPath = args[args.indexOf('-i') + 1]
      capturedManifest = fs.readFileSync(manifestPath, 'utf-8')
      const outputPath = args[args.length - 1]

      setTimeout(() => {
        fs.writeFileSync(outputPath, Buffer.from('fake-mp4'))
        proc.emit('close', 0)
      }, 0)

      return proc
    })

    try {
      const { buildActivityVideo } = await import('./video')
      const outputPath = await buildActivityVideo('activity-1', [
        createScreenshot(newer, 2_000),
        createScreenshot(older, 1_000),
      ])

      expect(mockSpawn).toHaveBeenCalledTimes(1)
      expect(mockSpawn.mock.calls[0][0]).toBe('/mock/ffmpeg')
      expect(fs.existsSync(outputPath)).toBe(true)
      expect(capturedManifest.indexOf('older.png')).toBeLessThan(
        capturedManifest.indexOf('newer.png'),
      )
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('should fail before spawning ffmpeg when screenshot is missing', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memorylane-video-'))
    const existing = path.join(tmpDir, 'existing.png')
    const missing = path.join(tmpDir, 'missing.png')
    fs.writeFileSync(existing, Buffer.from('existing'))

    try {
      const { buildActivityVideo, VideoBuildError } = await import('./video')

      await expect(
        buildActivityVideo('activity-2', [
          createScreenshot(existing, 1_000),
          createScreenshot(missing, 2_000),
        ]),
      ).rejects.toThrow(VideoBuildError)

      expect(mockSpawn).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
