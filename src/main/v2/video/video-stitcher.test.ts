import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FfmpegVideoStitcher } from './video-stitcher'

const FFMPEG_EXECUTABLE_ENV = 'MEMORYLANE_FFMPEG_EXECUTABLE'

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

interface MockChildProcess extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
}

function createMockChildProcess(): MockChildProcess {
  const processEmitter = new EventEmitter() as MockChildProcess
  processEmitter.stdout = new EventEmitter()
  processEmitter.stderr = new EventEmitter()
  return processEmitter
}

function manifestFromSpawnArgs(args: string[]): string {
  const concatPath = args[args.indexOf('-i') + 1]
  return fs.readFileSync(concatPath, 'utf8')
}

describe('FfmpegVideoStitcher', () => {
  const tempDirs: string[] = []
  let ffmpegExecutablePath: string

  beforeEach(() => {
    vi.resetAllMocks()
    const tempDir = createTempDir()
    ffmpegExecutablePath = path.join(tempDir, 'ffmpeg')
    fs.writeFileSync(ffmpegExecutablePath, '#!/bin/sh\nexit 0\n')
    process.env[FFMPEG_EXECUTABLE_ENV] = ffmpegExecutablePath
  })

  afterEach(() => {
    delete process.env[FFMPEG_EXECUTABLE_ENV]
    cleanup()
  })

  function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-stitcher-unit-'))
    tempDirs.push(dir)
    return dir
  }

  function createFrame(tempDir: string, name: string): string {
    const framePath = path.join(tempDir, name)
    fs.writeFileSync(framePath, 'fake-frame')
    return framePath
  }

  function cleanup(): void {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }
  }

  it('builds ffmpeg command and returns stitch result', async () => {
    const childProcess = await import('child_process')
    const tempDir = createTempDir()
    const frameA = createFrame(tempDir, 'a.png')
    const frameB = createFrame(tempDir, 'b.png')
    const outputPath = path.join(tempDir, 'out.mp4')

    const mockChild = createMockChildProcess()
    vi.mocked(childProcess.spawn).mockReturnValue(
      mockChild as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const stitcher = new FfmpegVideoStitcher()
    const promise = stitcher.stitch({
      activityId: 'activity-1',
      frames: [
        { filepath: frameA, timestamp: 1_000 },
        { filepath: frameB, timestamp: 2_000 },
      ],
      outputPath,
    })

    expect(childProcess.spawn).toHaveBeenCalledTimes(1)
    const [command, args] = vi.mocked(childProcess.spawn).mock.calls[0]
    expect(command).toBe(ffmpegExecutablePath)
    expect(args).toContain('-f')
    expect(args).toContain('concat')
    expect(args).toContain('-safe')
    expect(args).toContain('0')
    expect(args).toContain('-c:v')
    if (process.platform === 'darwin') {
      expect(args).toContain('h264_videotoolbox')
      expect(args).toContain('-b:v')
      expect(args).toContain('400k')
      expect(args).toContain('-maxrate')
      expect(args).toContain('-bufsize')
      expect(args).not.toContain('-crf')
    } else {
      expect(args).toContain('libx264')
      expect(args).toContain('-preset')
      expect(args).toContain('veryfast')
      expect(args).toContain('-crf')
      expect(args).toContain('28')
    }
    expect(args).toContain('-vf')
    expect(args).toContain('scale=trunc(iw/2)*2:trunc(ih/2)*2')
    expect(args).toContain('-pix_fmt')
    expect(args).toContain('yuv420p')
    expect(args).toContain('-movflags')
    expect(args).toContain('+faststart')
    expect(args).not.toContain('-r')
    expect(args[args.length - 1]).toBe(path.resolve(outputPath))

    const manifestContent = manifestFromSpawnArgs(args)
    expect(manifestContent.indexOf(path.resolve(frameA))).toBeLessThan(
      manifestContent.indexOf(path.resolve(frameB)),
    )
    expect(manifestContent).toContain('duration 1.000000')

    mockChild.emit('close', 0)

    await expect(promise).resolves.toEqual({
      videoPath: path.resolve(outputPath),
      frameCount: 2,
      durationMs: 2_000,
    })
  })

  it('derives frame durations from timestamps', async () => {
    const childProcess = await import('child_process')
    const tempDir = createTempDir()
    const frameA = createFrame(tempDir, 'a.png')
    const frameB = createFrame(tempDir, 'b.png')
    const frameC = createFrame(tempDir, 'c.png')

    const mockChild = createMockChildProcess()
    vi.mocked(childProcess.spawn).mockReturnValue(
      mockChild as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const stitcher = new FfmpegVideoStitcher()
    const promise = stitcher.stitch({
      activityId: 'activity-2',
      frames: [
        { filepath: frameA, timestamp: 1_000 },
        { filepath: frameB, timestamp: 1_500 },
        { filepath: frameC, timestamp: 3_000 },
      ],
      outputPath: path.join(tempDir, 'out.mp4'),
    })

    const [, args] = vi.mocked(childProcess.spawn).mock.calls[0]
    const manifestContent = manifestFromSpawnArgs(args)
    expect(manifestContent).toContain('duration 0.500000')
    expect(manifestContent).toContain('duration 1.500000')

    mockChild.emit('close', 0)
    await expect(promise).resolves.toMatchObject({ durationMs: 3_500 })
  })

  it('sorts frames by timestamp before writing concat manifest', async () => {
    const childProcess = await import('child_process')
    const tempDir = createTempDir()
    const frameA = createFrame(tempDir, 'a.png')
    const frameB = createFrame(tempDir, 'b.png')

    const mockChild = createMockChildProcess()
    vi.mocked(childProcess.spawn).mockReturnValue(
      mockChild as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const stitcher = new FfmpegVideoStitcher()
    const promise = stitcher.stitch({
      activityId: 'activity-3',
      frames: [
        { filepath: frameB, timestamp: 2_000 },
        { filepath: frameA, timestamp: 1_000 },
      ],
      outputPath: path.join(tempDir, 'out.mp4'),
    })

    const [, args] = vi.mocked(childProcess.spawn).mock.calls[0]
    const manifestContent = manifestFromSpawnArgs(args)
    expect(manifestContent.indexOf(path.resolve(frameA))).toBeLessThan(
      manifestContent.indexOf(path.resolve(frameB)),
    )

    mockChild.emit('close', 0)
    await promise
  })

  it('creates a one-second video when only one frame is provided', async () => {
    const childProcess = await import('child_process')
    const tempDir = createTempDir()
    const frameA = createFrame(tempDir, 'a.png')
    const outputPath = path.join(tempDir, 'out.mp4')

    const mockChild = createMockChildProcess()
    vi.mocked(childProcess.spawn).mockReturnValue(
      mockChild as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const stitcher = new FfmpegVideoStitcher()
    const promise = stitcher.stitch({
      activityId: 'activity-single-frame',
      frames: [{ filepath: frameA, timestamp: 1_000 }],
      outputPath,
    })

    const [, args] = vi.mocked(childProcess.spawn).mock.calls[0]
    const manifestContent = manifestFromSpawnArgs(args)
    const resolvedFrame = path.resolve(frameA)
    const fileEntries = manifestContent
      .split('\n')
      .filter((line) => line === `file '${resolvedFrame}'`)
    expect(fileEntries).toHaveLength(2)
    expect(manifestContent).toContain('duration 1.000000')

    mockChild.emit('close', 0)
    await expect(promise).resolves.toEqual({
      videoPath: path.resolve(outputPath),
      frameCount: 1,
      durationMs: 1_000,
    })
  })

  it('rejects when no frames are provided', async () => {
    const stitcher = new FfmpegVideoStitcher()
    await expect(
      stitcher.stitch({
        activityId: 'activity-4',
        frames: [],
        outputPath: path.join(os.tmpdir(), 'out.mp4'),
      }),
    ).rejects.toThrow('at least 1 frame path')
  })

  it('rejects when a frame path is missing', async () => {
    const tempDir = createTempDir()
    const frameA = createFrame(tempDir, 'a.png')
    const missing = path.join(tempDir, 'missing.png')

    const stitcher = new FfmpegVideoStitcher()
    await expect(
      stitcher.stitch({
        activityId: 'activity-5',
        frames: [
          { filepath: frameA, timestamp: 1_000 },
          { filepath: missing, timestamp: 2_000 },
        ],
        outputPath: path.join(tempDir, 'out.mp4'),
      }),
    ).rejects.toThrow(`Frame file not found: ${missing}`)
  })

  it('rejects when a frame timestamp is invalid', async () => {
    const tempDir = createTempDir()
    const frameA = createFrame(tempDir, 'a.png')
    const frameB = createFrame(tempDir, 'b.png')

    const stitcher = new FfmpegVideoStitcher()
    await expect(
      stitcher.stitch({
        activityId: 'activity-6',
        frames: [
          { filepath: frameA, timestamp: Number.NaN },
          { filepath: frameB, timestamp: 2_000 },
        ],
        outputPath: path.join(tempDir, 'out.mp4'),
      }),
    ).rejects.toThrow('Frame timestamp must be a finite number')
  })

  it('cleans up concat temp file when ffmpeg exits non-zero', async () => {
    const childProcess = await import('child_process')
    const tempDir = createTempDir()
    const frameA = createFrame(tempDir, 'a.png')
    const frameB = createFrame(tempDir, 'b.png')

    const firstChild = createMockChildProcess()
    const secondChild = createMockChildProcess()
    if (process.platform === 'darwin') {
      vi.mocked(childProcess.spawn)
        .mockReturnValueOnce(firstChild as unknown as ReturnType<typeof childProcess.spawn>)
        .mockReturnValueOnce(secondChild as unknown as ReturnType<typeof childProcess.spawn>)
    } else {
      vi.mocked(childProcess.spawn).mockReturnValue(
        firstChild as unknown as ReturnType<typeof childProcess.spawn>,
      )
    }

    const stitcher = new FfmpegVideoStitcher()
    const promise = stitcher.stitch({
      activityId: 'activity-7',
      frames: [
        { filepath: frameA, timestamp: 1_000 },
        { filepath: frameB, timestamp: 2_000 },
      ],
      outputPath: path.join(tempDir, 'out.mp4'),
    })

    const [, args] = vi.mocked(childProcess.spawn).mock.calls[0]
    const concatPath = args[args.indexOf('-i') + 1]
    expect(fs.existsSync(concatPath)).toBe(true)

    firstChild.stderr.emit('data', 'encoder failed')
    firstChild.emit('close', 1)
    if (process.platform === 'darwin') {
      await Promise.resolve()
      secondChild.stderr.emit('data', 'encoder failed')
      secondChild.emit('close', 1)
    }

    await expect(promise).rejects.toThrow('ffmpeg exited with code 1: encoder failed')
    expect(fs.existsSync(concatPath)).toBe(false)
  })

  it('returns a clear error when ffmpeg is missing', async () => {
    const childProcess = await import('child_process')
    const tempDir = createTempDir()
    const frameA = createFrame(tempDir, 'a.png')
    const frameB = createFrame(tempDir, 'b.png')

    const firstChild = createMockChildProcess()
    const secondChild = createMockChildProcess()
    if (process.platform === 'darwin') {
      vi.mocked(childProcess.spawn)
        .mockReturnValueOnce(firstChild as unknown as ReturnType<typeof childProcess.spawn>)
        .mockReturnValueOnce(secondChild as unknown as ReturnType<typeof childProcess.spawn>)
    } else {
      vi.mocked(childProcess.spawn).mockReturnValue(
        firstChild as unknown as ReturnType<typeof childProcess.spawn>,
      )
    }

    const stitcher = new FfmpegVideoStitcher()
    const promise = stitcher.stitch({
      activityId: 'activity-8',
      frames: [
        { filepath: frameA, timestamp: 1_000 },
        { filepath: frameB, timestamp: 2_000 },
      ],
      outputPath: path.join(tempDir, 'out.mp4'),
    })

    const error = new Error('spawn ffmpeg ENOENT') as NodeJS.ErrnoException
    error.code = 'ENOENT'
    firstChild.emit('error', error)
    if (process.platform === 'darwin') {
      await Promise.resolve()
      const error2 = new Error('spawn ffmpeg ENOENT') as NodeJS.ErrnoException
      error2.code = 'ENOENT'
      secondChild.emit('error', error2)
    }

    await expect(promise).rejects.toThrow(`ffmpeg executable not found: ${ffmpegExecutablePath}`)
  })

  it('uses h264_videotoolbox by default on macOS', async () => {
    if (process.platform !== 'darwin') return

    const childProcess = await import('child_process')
    const tempDir = createTempDir()
    const frameA = createFrame(tempDir, 'a.png')
    const frameB = createFrame(tempDir, 'b.png')
    const outputPath = path.join(tempDir, 'out.mp4')

    const mockChild = createMockChildProcess()
    vi.mocked(childProcess.spawn).mockReturnValue(
      mockChild as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const stitcher = new FfmpegVideoStitcher()
    const promise = stitcher.stitch({
      activityId: 'activity-vt-1',
      frames: [
        { filepath: frameA, timestamp: 1_000 },
        { filepath: frameB, timestamp: 2_000 },
      ],
      outputPath,
    })

    expect(childProcess.spawn).toHaveBeenCalledTimes(1)
    const [, args] = vi.mocked(childProcess.spawn).mock.calls[0]
    expect(args).toContain('-c:v')
    expect(args).toContain('h264_videotoolbox')
    expect(args).toContain('-b:v')
    expect(args).toContain('400k')
    expect(args).toContain('-maxrate')
    expect(args).toContain('-bufsize')
    expect(args).not.toContain('-crf')

    mockChild.emit('close', 0)
    await expect(promise).resolves.toMatchObject({ frameCount: 2 })
  })

  it('falls back to libx264 when default h264_videotoolbox encode fails on macOS', async () => {
    if (process.platform !== 'darwin') return

    const childProcess = await import('child_process')
    const tempDir = createTempDir()
    const frameA = createFrame(tempDir, 'a.png')
    const frameB = createFrame(tempDir, 'b.png')
    const outputPath = path.join(tempDir, 'out.mp4')

    const firstChild = createMockChildProcess()
    const secondChild = createMockChildProcess()
    vi.mocked(childProcess.spawn)
      .mockReturnValueOnce(firstChild as unknown as ReturnType<typeof childProcess.spawn>)
      .mockReturnValueOnce(secondChild as unknown as ReturnType<typeof childProcess.spawn>)

    const stitcher = new FfmpegVideoStitcher()
    const promise = stitcher.stitch({
      activityId: 'activity-vt-fallback',
      frames: [
        { filepath: frameA, timestamp: 1_000 },
        { filepath: frameB, timestamp: 2_000 },
      ],
      outputPath,
    })

    expect(childProcess.spawn).toHaveBeenCalledTimes(1)
    const [, firstArgs] = vi.mocked(childProcess.spawn).mock.calls[0]
    expect(firstArgs).toContain('h264_videotoolbox')

    firstChild.stderr.emit('data', 'videotoolbox failed')
    firstChild.emit('close', 1)
    await Promise.resolve()

    expect(childProcess.spawn).toHaveBeenCalledTimes(2)
    const [, secondArgs] = vi.mocked(childProcess.spawn).mock.calls[1]
    expect(secondArgs).toContain('libx264')

    secondChild.emit('close', 0)
    await expect(promise).resolves.toMatchObject({ frameCount: 2 })
  })
})
