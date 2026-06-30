import * as fs from 'fs'
import * as path from 'path'
import log from '@main/utils/logger'

/**
 * Base for the debug-pipeline stream dumpers: appends each stream record to a
 * JSONL file, stamping `dumpedAt` (wall-clock at dump time) and `lagMs` (the
 * delay between when the record's reference event occurred and when it was
 * dumped). Subclasses pick which timestamp `lagMs` is measured against.
 *
 * Dev-only: every dumper is wired in runtime.ts behind the `DEBUG_PIPELINE`
 * gate, and only for records that already passed the capture blacklist upstream.
 */
export abstract class StreamJsonlDumper<T extends object> {
  private readonly filePath: string
  private readonly label: string

  constructor(rootDir: string, fileName: string, label: string) {
    fs.mkdirSync(rootDir, { recursive: true })
    this.filePath = path.join(rootDir, fileName)
    this.label = label
    log.info(`[${label}] Writing to ${this.filePath}`)
  }

  getFilePath(): string {
    return this.filePath
  }

  /** The record timestamp `lagMs` is measured from (dumpedAt - this). */
  protected abstract referenceTimestamp(record: T): number

  dump(record: T): void {
    try {
      const dumpedAt = Date.now()
      const out = { dumpedAt, lagMs: dumpedAt - this.referenceTimestamp(record), ...record }
      fs.appendFileSync(this.filePath, `${JSON.stringify(out)}\n`, 'utf8')
    } catch (error) {
      log.warn(
        `[${this.label}] Failed to write record`,
        error instanceof Error ? error.message : String(error),
      )
    }
  }
}
