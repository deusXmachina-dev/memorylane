import * as fs from 'fs'
import * as zlib from 'zlib'
import { stripDatabaseForUpload, type StripOptions } from './strip-database-for-upload'

export interface UploadPrepRequest {
  tempPath: string
  stripOptions: StripOptions
}

export type UploadPrepResponse = { ok: true; gzip: ArrayBuffer } | { ok: false; error: string }

/**
 * Strip the backup DB (drop sensitive tables/columns + VACUUM), then read and
 * gzip it. Every step here is synchronous, CPU/IO-heavy SQLite work, so this
 * MUST run off the Electron main thread (inside a utilityProcess) — otherwise
 * the VACUUM/column-rewrite freezes the UI.
 */
export function prepareUploadSync(tempPath: string, stripOptions: StripOptions): Buffer {
  stripDatabaseForUpload(tempPath, stripOptions)
  return zlib.gzipSync(fs.readFileSync(tempPath))
}

// utilityProcess child wiring. `process.parentPort` only exists when this file
// is run as a forked utilityProcess; guarding it keeps the module import-safe
// for unit tests that exercise `prepareUploadSync` directly.
interface ParentPortLike {
  on(event: 'message', listener: (e: { data: UploadPrepRequest }) => void): void
  postMessage(message: UploadPrepResponse, transfer?: ArrayBuffer[]): void
}
const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort
if (parentPort) {
  parentPort.on('message', ({ data }) => {
    try {
      const buf = prepareUploadSync(data.tempPath, data.stripOptions)
      // Copy out an exact-size ArrayBuffer and transfer it (zero-copy) so a
      // large compressed blob doesn't get structured-cloned across the boundary.
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      parentPort.postMessage({ ok: true, gzip: ab }, [ab])
    } catch (err) {
      parentPort.postMessage({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })
}
