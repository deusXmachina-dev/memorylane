import * as fs from 'fs'
import * as path from 'path'
import log from './logger'
import type { Frame } from './recorder/screen-capturer'

/**
 * Appends every captured Frame to a JSONL file in the debug-pipeline directory,
 * recording the screenshot's metadata (path, timestamp, dimensions, display,
 * sequence number) as it enters the frame stream.
 *
 * Dev-only: wired in runtime.ts behind the same `DEBUG_PIPELINE` gate as the
 * semantic round-trip dumper. The referenced PNGs survive on disk because the
 * debug pipeline forces `retainScreenshots`, so a session's frames can later be
 * promoted into a replay fixture. No blacklist routing is needed: frames for
 * blocked apps are suppressed upstream at the capturer and never reach the
 * stream. Each record carries `dumpedAt` and `lagMs` (dumpedAt - frame.timestamp).
 */
export class FrameDebugDumper {
  private readonly filePath: string

  constructor(rootDir: string, fileName = 'frames.jsonl') {
    fs.mkdirSync(rootDir, { recursive: true })
    this.filePath = path.join(rootDir, fileName)
    log.info(`[FrameDebugDumper] Writing frame metadata to ${this.filePath}`)
  }

  getFilePath(): string {
    return this.filePath
  }

  dump(frame: Frame): void {
    try {
      const dumpedAt = Date.now()
      const record = { dumpedAt, lagMs: dumpedAt - frame.timestamp, ...frame }
      fs.appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf8')
    } catch (error) {
      log.warn(
        '[FrameDebugDumper] Failed to write frame metadata',
        error instanceof Error ? error.message : String(error),
      )
    }
  }
}
