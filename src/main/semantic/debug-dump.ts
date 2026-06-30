import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import log from '@main/utils/logger'
import type { SemanticDebugDumper, SemanticRoundTripDump } from './types'

export interface SemanticFileDebugDumperConfig {
  rootDir: string
  cleanRootDir?: boolean
  copyMediaAssets?: boolean
}

export class SemanticFileDebugDumper implements SemanticDebugDumper {
  private readonly runDir: string
  private readonly copyMediaAssets: boolean
  private dumpCounter = 0

  constructor(config: SemanticFileDebugDumperConfig) {
    if (config.cleanRootDir && fs.existsSync(config.rootDir)) {
      fs.rmSync(config.rootDir, { recursive: true, force: true })
    }

    fs.mkdirSync(config.rootDir, { recursive: true })
    const runLabel = `${new Date().toISOString().replace(/[:.]/g, '-')}_pid-${process.pid}`
    this.runDir = path.join(config.rootDir, runLabel)
    fs.mkdirSync(this.runDir, { recursive: true })
    this.copyMediaAssets = Boolean(config.copyMediaAssets)

    log.info(`[SemanticFileDebugDumper] Writing semantic dumps to ${this.runDir}`)
  }

  getRunDir(): string {
    return this.runDir
  }

  dumpRoundTrip(input: SemanticRoundTripDump): void {
    try {
      this.dumpCounter += 1
      const modelSlug = this.slug(input.model)
      const modeSlug = this.slug(input.mode)
      const attemptDir = path.join(
        this.runDir,
        `${String(this.dumpCounter).padStart(3, '0')}_${modeSlug}_${modelSlug}`,
      )
      fs.mkdirSync(attemptDir, { recursive: true })

      const requestSha256 = this.sha256(input.requestJson)
      const responseSha256 = input.responseJson ? this.sha256(input.responseJson) : null
      const copiedMediaFiles = this.copyMediaAssets ? this.dumpMediaAssets(attemptDir, input) : []

      const metadata = {
        activityId: input.activityId,
        mode: input.mode,
        model: input.model,
        startedAt: input.startedAt,
        durationMs: input.durationMs,
        success: input.success,
        error: input.error ?? null,
        requestSha256,
        responseSha256,
        copiedMediaFiles,
      }

      this.writeFileAtomic(
        path.join(attemptDir, 'metadata.json'),
        `${JSON.stringify(metadata, null, 2)}\n`,
      )
      this.writeFileAtomic(path.join(attemptDir, 'request.json'), input.requestJson)

      if (input.responseJson) {
        this.writeFileAtomic(path.join(attemptDir, 'response.json'), input.responseJson)
      }
      if (input.summary !== undefined) {
        this.writeFileAtomic(path.join(attemptDir, 'summary.txt'), `${input.summary}\n`)
      }
      if (input.error) {
        this.writeFileAtomic(path.join(attemptDir, 'error.txt'), `${input.error}\n`)
      }
    } catch (error) {
      log.warn(
        '[SemanticFileDebugDumper] Failed to dump semantic round-trip',
        JSON.stringify({ error: this.describeError(error) }),
      )
    }
  }

  private writeFileAtomic(filepath: string, content: string): void {
    const tempPath = `${filepath}.tmp-${process.pid}-${Date.now()}`
    fs.writeFileSync(tempPath, content, 'utf8')
    fs.renameSync(tempPath, filepath)
  }

  private writeBinaryAtomic(filepath: string, content: Buffer): void {
    const tempPath = `${filepath}.tmp-${process.pid}-${Date.now()}`
    fs.writeFileSync(tempPath, content)
    fs.renameSync(tempPath, filepath)
  }

  private dumpMediaAssets(attemptDir: string, input: SemanticRoundTripDump): string[] {
    const copiedFiles: string[] = []
    let videoIndex = 0
    let imageIndex = 0

    for (const message of input.request.messages) {
      for (const item of message.content) {
        let mediaUrl: string | undefined
        let filenamePrefix: 'input-video' | 'input-image' | null = null

        if (item.type === 'input_video') {
          mediaUrl = item.videoUrl.url
          filenamePrefix = 'input-video'
        } else if (item.type === 'image_url') {
          mediaUrl = item.imageUrl.url
          filenamePrefix = 'input-image'
        }

        if (!mediaUrl || !filenamePrefix) {
          continue
        }

        const parsed = this.parseDataUrl(mediaUrl)
        if (!parsed) {
          continue
        }

        if (filenamePrefix === 'input-video') {
          videoIndex += 1
        } else {
          imageIndex += 1
        }
        const index = filenamePrefix === 'input-video' ? videoIndex : imageIndex
        const extension = this.fileExtensionForMime(parsed.mimeType, filenamePrefix)
        const filename = `${filenamePrefix}-${String(index).padStart(2, '0')}.${extension}`
        const filepath = path.join(attemptDir, filename)
        this.writeBinaryAtomic(filepath, parsed.bytes)
        copiedFiles.push(filename)
      }
    }

    return copiedFiles
  }

  private parseDataUrl(dataUrl: string): { mimeType: string; bytes: Buffer } | null {
    if (!dataUrl.startsWith('data:')) {
      return null
    }

    const commaIdx = dataUrl.indexOf(',')
    if (commaIdx <= 5) {
      return null
    }

    const header = dataUrl.slice(5, commaIdx)
    const payload = dataUrl.slice(commaIdx + 1)
    const headerParts = header.split(';').filter((part) => part.length > 0)
    const mimeType = headerParts[0] ?? 'application/octet-stream'
    const isBase64 = headerParts.includes('base64')

    try {
      const bytes = isBase64
        ? Buffer.from(payload, 'base64')
        : Buffer.from(decodeURIComponent(payload), 'utf8')
      return { mimeType, bytes }
    } catch {
      return null
    }
  }

  private fileExtensionForMime(mimeType: string, mediaType: 'input-video' | 'input-image'): string {
    switch (mimeType) {
      case 'video/mp4':
        return 'mp4'
      case 'video/webm':
        return 'webm'
      case 'video/ogg':
        return 'ogv'
      case 'image/png':
        return 'png'
      case 'image/jpeg':
      case 'image/jpg':
        return 'jpg'
      case 'image/webp':
        return 'webp'
      case 'image/gif':
        return 'gif'
      default:
        return mediaType === 'input-video' ? 'bin' : 'img'
    }
  }

  private slug(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex')
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) return error.message
    return String(error)
  }
}
