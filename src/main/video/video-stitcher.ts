import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type {
  ActivityVideoAsset,
  ActivityVideoFrameInput,
  ActivityVideoStitcher,
} from '../activity-transformer-types'
import { resolveFfmpegExecutable, runFfmpeg } from './ffmpeg'

const DEFAULT_FRAME_DURATION_MS = 1_000
const FFMPEG_VIDEO_PRESET = 'ultrafast'
const FFMPEG_VIDEO_CRF = '28'
const FFMPEG_VIDEO_THREADS = '1'

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
        '-threads',
        FFMPEG_VIDEO_THREADS,
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
