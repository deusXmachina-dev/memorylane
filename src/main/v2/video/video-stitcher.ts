import { spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type {
  ActivityVideoAsset,
  ActivityVideoFrameInput,
  ActivityVideoStitcher,
} from '../activity-transformer-types'

const DEFAULT_FRAME_DURATION_MS = 1_000
const FFMPEG_EXECUTABLE_ENV = 'MEMORYLANE_FFMPEG_EXECUTABLE'
const FFMPEG_VIDEO_PRESET = 'veryfast'
const FFMPEG_VIDEO_CRF = '28'

function isPathInsideAsarArchive(filepath: string): boolean {
  return /\.asar([/\\])/.test(filepath)
}

function escapeConcatPath(filepath: string): string {
  return filepath.replace(/'/g, "'\\''")
}

function sortFramesByTimestamp(frames: ActivityVideoFrameInput[]): ActivityVideoFrameInput[] {
  return frames
    .map((frame, index) => ({ ...frame, index }))
    .sort((left, right) => {
      if (left.timestamp !== right.timestamp) {
        return left.timestamp - right.timestamp
      }
      return left.index - right.index
    })
    .map(({ filepath, timestamp }) => ({ filepath, timestamp }))
}

function assertFrames(frames: ActivityVideoFrameInput[]): void {
  if (frames.length < 1) {
    throw new Error('Video stitcher requires at least 1 frame path')
  }

  for (const frame of frames) {
    if (!Number.isFinite(frame.timestamp)) {
      throw new Error(`Frame timestamp must be a finite number: ${frame.timestamp}`)
    }
    if (!fs.existsSync(frame.filepath)) {
      throw new Error(`Frame file not found: ${frame.filepath}`)
    }
  }
}

function deriveFrameDurationsMs(frames: ActivityVideoFrameInput[]): number[] {
  const durationsMs: number[] = []

  for (let i = 0; i < frames.length - 1; i++) {
    const delta = frames[i + 1].timestamp - frames[i].timestamp
    durationsMs.push(delta > 0 ? delta : DEFAULT_FRAME_DURATION_MS)
  }

  durationsMs.push(durationsMs[durationsMs.length - 1] ?? DEFAULT_FRAME_DURATION_MS)
  return durationsMs
}

function buildConcatManifest(frames: ActivityVideoFrameInput[], durationsMs: number[]): string {
  const resolved = frames.map((frame) => path.resolve(frame.filepath))
  const lines: string[] = []

  for (let i = 0; i < resolved.length; i++) {
    const framePath = resolved[i]
    const durationSeconds = durationsMs[i] / 1_000
    lines.push(`file '${escapeConcatPath(framePath)}'`)
    lines.push(`duration ${durationSeconds.toFixed(6)}`)
  }

  // concat demuxer ignores the final duration entry unless the last file is repeated
  lines.push(`file '${escapeConcatPath(resolved[resolved.length - 1])}'`)

  return lines.join('\n') + '\n'
}

function resolveAsarUnpackedPath(filepath: string): string {
  return filepath.replace(/\.asar([/\\])/, '.asar.unpacked$1')
}

function resolveExecutablePath(filepath: string, source: string): string {
  const unpackedPath = resolveAsarUnpackedPath(filepath)

  if (unpackedPath !== filepath && fs.existsSync(unpackedPath)) {
    return unpackedPath
  }

  if (isPathInsideAsarArchive(filepath)) {
    throw new Error(
      `${source} resolved inside app.asar, but unpacked binary was not found: ${unpackedPath}`,
    )
  }

  if (!fs.existsSync(filepath)) {
    throw new Error(`${source} executable not found: ${filepath}`)
  }

  return filepath
}

function resolveFfmpegStaticPath(): string {
  let resolvedPath: string | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    resolvedPath = require('ffmpeg-static') as string | null
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to resolve ffmpeg-static module: ${detail}`)
  }

  if (!resolvedPath) {
    throw new Error('ffmpeg-static did not provide a binary for this platform')
  }

  return resolveExecutablePath(resolvedPath, 'ffmpeg-static')
}

function resolveFfmpegExecutable(): string {
  const overridePath = process.env[FFMPEG_EXECUTABLE_ENV]
  if (overridePath && overridePath.length > 0) {
    if (!fs.existsSync(overridePath) && resolveAsarUnpackedPath(overridePath) === overridePath) {
      throw new Error(`ffmpeg executable override does not exist: ${overridePath}`)
    }
    return resolveExecutablePath(overridePath, 'ffmpeg executable override')
  }

  return resolveFfmpegStaticPath()
}

function runFfmpeg(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    let settled = false
    let stderr = ''

    const settleReject = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    proc.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        settleReject(new Error(`ffmpeg executable not found: ${command}`))
        return
      }
      settleReject(new Error(`Failed to spawn ffmpeg (${command}): ${error.message}`))
    })

    proc.on('close', (code) => {
      if (settled) return
      settled = true

      if (code === 0) {
        resolve()
        return
      }

      const details = stderr.trim()
      if (details.length > 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${details}`))
        return
      }

      reject(new Error(`ffmpeg exited with code ${code}`))
    })
  })
}

export class FfmpegVideoStitcher implements ActivityVideoStitcher {
  async stitch(input: {
    activityId: string
    frames: ActivityVideoFrameInput[]
    outputPath: string
  }): Promise<ActivityVideoAsset> {
    void input.activityId
    assertFrames(input.frames)
    const frames = sortFramesByTimestamp(input.frames)
    const frameDurationsMs = deriveFrameDurationsMs(frames)
    const durationMs = frameDurationsMs.reduce((sum, value) => sum + value, 0)

    const outputPath = path.resolve(input.outputPath)
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })

    const concatPath = path.join(
      os.tmpdir(),
      `memorylane-ffmpeg-concat-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
    )
    fs.writeFileSync(concatPath, buildConcatManifest(frames, frameDurationsMs), 'utf8')
    const ffmpegExecutable = resolveFfmpegExecutable()

    try {
      await runFfmpeg(ffmpegExecutable, [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatPath,
        '-c:v',
        'libx264',
        '-preset',
        FFMPEG_VIDEO_PRESET,
        '-crf',
        FFMPEG_VIDEO_CRF,
        '-vf',
        'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        outputPath,
      ])
    } finally {
      try {
        fs.unlinkSync(concatPath)
      } catch {
        // best-effort cleanup
      }
    }

    return {
      videoPath: outputPath,
      frameCount: frames.length,
      durationMs,
    }
  }
}
