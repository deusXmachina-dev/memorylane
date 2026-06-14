import * as fs from 'fs'
import * as path from 'path'
import log from './logger'
import type { EventWindow } from '../shared/types'

/**
 * Appends every EventWindow to a JSONL file in the debug-pipeline directory.
 * This is the replay-critical input: the ActivityProducer consumes a stream of
 * EventWindows (which embed their raw interaction events), so a captured window
 * stream can be fed straight back into a fresh producer during replay without
 * re-running the wall-clock-driven EventCapturer windowing.
 *
 * Dev-only: wired in runtime.ts behind the same `DEBUG_PIPELINE` gate as the
 * semantic round-trip dumper. Windows reach the event stream only after their
 * events pass the capture blacklist, so excluded titles/URLs never land here —
 * but hand-review fixtures for private content before committing them. Each
 * record carries `dumpedAt` and `lagMs` (dumpedAt - window.endTimestamp).
 */
export class EventWindowDebugDumper {
  private readonly filePath: string

  constructor(rootDir: string, fileName = 'event-windows.jsonl') {
    fs.mkdirSync(rootDir, { recursive: true })
    this.filePath = path.join(rootDir, fileName)
    log.info(`[EventWindowDebugDumper] Writing event windows to ${this.filePath}`)
  }

  getFilePath(): string {
    return this.filePath
  }

  dump(window: EventWindow): void {
    try {
      const dumpedAt = Date.now()
      const record = { dumpedAt, lagMs: dumpedAt - window.endTimestamp, ...window }
      fs.appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf8')
    } catch (error) {
      log.warn(
        '[EventWindowDebugDumper] Failed to write event window',
        error instanceof Error ? error.message : String(error),
      )
    }
  }
}
