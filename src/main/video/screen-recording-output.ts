import fs, { promises as fsp } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { resolveFfmpegExecutable, runFfmpeg } from './ffmpeg'

const RECORDING_VIDEO_PRESET = 'veryfast'
const RECORDING_VIDEO_CRF = '23'
const RECORDING_AUDIO_BITRATE = '128k'

export class ScreenRecordingOutput {
  private constructor(
    readonly outputPath: string,
    private readonly tempPath: string,
    private readonly writeStream: fs.WriteStream,
  ) {}

  static async create(timestamp = Date.now()): Promise<ScreenRecordingOutput> {
    const recordingsDirectory = getScreenRecordingsDirectory()
    await fsp.mkdir(recordingsDirectory, { recursive: true })

    const basename = `Recording ${formatTimestampForFilename(timestamp)}`
    const outputPath = path.join(recordingsDirectory, `${basename}.mp4`)
    const tempPath = path.join(recordingsDirectory, `${basename}.webm.part`)
    const writeStream = fs.createWriteStream(tempPath, { flags: 'w' })

    return new ScreenRecordingOutput(outputPath, tempPath, writeStream)
  }

  async appendChunk(chunk: Buffer): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.writeStream.write(chunk, (error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }

  async finalize(): Promise<string> {
    try {
      await new Promise<void>((resolve, reject) => {
        this.writeStream.end((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })

      await transcodeRecording(this.tempPath, this.outputPath)
      await safeUnlink(this.tempPath)
      return this.outputPath
    } catch (error) {
      await safeUnlink(this.tempPath)
      throw error
    }
  }

  async cleanup(): Promise<void> {
    this.writeStream.destroy()
    await safeUnlink(this.tempPath)
  }
}

export function getScreenRecordingsDirectory(): string {
  return path.join(app.getPath('videos'), 'MemoryLane')
}

async function transcodeRecording(inputPath: string, outputPath: string): Promise<void> {
  const ffmpegExecutable = resolveFfmpegExecutable()
  await runFfmpeg(ffmpegExecutable, [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-c:v',
    'libx264',
    '-preset',
    RECORDING_VIDEO_PRESET,
    '-crf',
    RECORDING_VIDEO_CRF,
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    RECORDING_AUDIO_BITRATE,
    '-movflags',
    '+faststart',
    outputPath,
  ])
}

async function safeUnlink(filepath: string): Promise<void> {
  try {
    await fsp.unlink(filepath)
  } catch {
    // Ignore missing partial files.
  }
}

function formatTimestampForFilename(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  const seconds = `${date.getSeconds()}`.padStart(2, '0')
  return `${year}-${month}-${day} ${hours}-${minutes}-${seconds}`
}
