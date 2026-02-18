import { app } from 'electron'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawn } from 'child_process'
import ffmpegStatic from 'ffmpeg-static'
import { ActivityScreenshot } from '../../shared/types'

const OUTPUT_FPS = 1
const VIDEO_WIDTH = 1920
const VIDEO_HEIGHT = 1080
const ENCODE_TIMEOUT_MS = 120_000

export class VideoBuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VideoBuildError'
  }
}

function escapeForConcatFile(filepath: string): string {
  return filepath.replace(/\\/g, '/').replace(/'/g, "'\\''")
}

function resolveFfmpegPath(): string {
  if (app.isPackaged) {
    const packagedPath = path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      'ffmpeg-static',
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
    )
    if (fs.existsSync(packagedPath)) {
      return packagedPath
    }
  }

  if (ffmpegStatic) {
    return ffmpegStatic
  }

  throw new VideoBuildError(
    'ffmpeg binary not found. Ensure ffmpeg-static is installed and packaged.',
  )
}

function buildConcatManifest(screenshots: ActivityScreenshot[]): string {
  const sorted = [...screenshots].sort((a, b) => a.timestamp - b.timestamp)
  const lines: string[] = []

  for (const screenshot of sorted) {
    lines.push(`file '${escapeForConcatFile(screenshot.filepath)}'`)
    lines.push('duration 1')
  }

  const last = sorted[sorted.length - 1]
  lines.push(`file '${escapeForConcatFile(last.filepath)}'`)
  return `${lines.join('\n')}\n`
}

async function runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let stderr = ''
    let timedOut = false

    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    const timeout = setTimeout(() => {
      timedOut = true
      proc.kill('SIGTERM')
    }, ENCODE_TIMEOUT_MS)

    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    proc.on('error', (error) => {
      clearTimeout(timeout)
      reject(new VideoBuildError(`Failed to spawn ffmpeg: ${error.message}`))
    })

    proc.on('close', (code) => {
      clearTimeout(timeout)
      if (timedOut) {
        reject(new VideoBuildError(`ffmpeg timed out after ${ENCODE_TIMEOUT_MS}ms`))
        return
      }
      if (code !== 0) {
        const detail = stderr.trim() || `exit code ${code}`
        reject(new VideoBuildError(`ffmpeg failed: ${detail}`))
        return
      }
      resolve()
    })
  })
}

/**
 * Build a transient MP4 from screenshot files in timestamp order.
 */
export async function buildActivityVideo(
  activityId: string,
  screenshots: ActivityScreenshot[],
): Promise<string> {
  if (screenshots.length === 0) {
    throw new VideoBuildError('Cannot build video without screenshots')
  }

  const missing = screenshots.find((s) => !fs.existsSync(s.filepath))
  if (missing) {
    throw new VideoBuildError(`Screenshot file not found: ${missing.filepath}`)
  }

  const ffmpegPath = resolveFfmpegPath()
  const sorted = [...screenshots].sort((a, b) => a.timestamp - b.timestamp)
  const outputDir = path.dirname(sorted[0].filepath)
  const outputPath = path.join(outputDir, `${sorted[0].timestamp}_${activityId}.mp4`)
  const manifestPath = path.join(os.tmpdir(), `memorylane-${activityId}.ffconcat`)

  fs.writeFileSync(manifestPath, buildConcatManifest(sorted), 'utf-8')

  try {
    const args = [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      manifestPath,
      '-vf',
      `fps=${OUTPUT_FPS},scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=decrease,pad=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '28',
      '-movflags',
      '+faststart',
      outputPath,
    ]

    await runFfmpeg(ffmpegPath, args)
  } finally {
    if (fs.existsSync(manifestPath)) {
      fs.unlinkSync(manifestPath)
    }
  }

  if (!fs.existsSync(outputPath)) {
    throw new VideoBuildError(`Video output was not created: ${outputPath}`)
  }

  return outputPath
}
