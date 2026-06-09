import * as fs from 'fs'
import * as path from 'path'
import log from './logger'
import type { InteractionContext } from '../shared/types'

/**
 * Appends every emitted InteractionContext to a JSONL file in the debug-pipeline
 * directory, for inspecting the raw interaction stream (timestamps, durations,
 * interim scroll/typing sub-windows, app changes).
 *
 * Dev-only: wired in runtime.ts behind the same `DEBUG_PIPELINE` gate as the
 * semantic round-trip dumper. Each record carries `dumpedAt` (wall-clock at dump
 * time) and `lagMs` (dumpedAt - event.timestamp) so the debounce delay between
 * when an interaction occurred and when it was emitted is visible at a glance.
 */
export class InteractionEventDebugDumper {
  private readonly filePath: string

  constructor(rootDir: string, fileName = 'interaction-events.jsonl') {
    fs.mkdirSync(rootDir, { recursive: true })
    this.filePath = path.join(rootDir, fileName)
    log.info(`[InteractionEventDebugDumper] Writing interaction events to ${this.filePath}`)
  }

  getFilePath(): string {
    return this.filePath
  }

  dump(event: InteractionContext): void {
    try {
      const dumpedAt = Date.now()
      const record = { dumpedAt, lagMs: dumpedAt - event.timestamp, ...event }
      fs.appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf8')
    } catch (error) {
      log.warn(
        '[InteractionEventDebugDumper] Failed to write interaction event',
        error instanceof Error ? error.message : String(error),
      )
    }
  }
}
