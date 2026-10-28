import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as zlib from 'zlib'
import { forwardLogsToParent, type WorkerLogEvent } from '@main/utils/worker-log'

export interface DeltaRequest {
  kind: 'delta'
  dbPath: string
  outPath: string
  sinceTs: number
}

export interface SnapshotRequest {
  kind: 'snapshot'
  path: string
}

export type UploadPrepRequest = DeltaRequest | SnapshotRequest

export type UploadPrepResponse = { ok: true; gzip: ArrayBuffer } | { ok: false; error: string }

export const ACTIVITY_COLUMNS = [
  'id',
  'start_timestamp',
  'end_timestamp',
  'app_name',
  'window_title',
  'tld',
  'summary',
  'summary_model',
  'ocr_text',
]

const SNAPSHOT_TABLES = ['clusters', 'cluster_sightings', 'sightings', 'user_context']

export function buildDeltaSync(req: DeltaRequest): Buffer {
  const out = new Database(req.outPath)
  try {
    out.prepare('ATTACH DATABASE ? AS src').run(req.dbPath)
    out.transaction(() => {
      out
        .prepare(
          `CREATE TABLE main.activities AS
           SELECT ${ACTIVITY_COLUMNS.join(', ')} FROM src.activities
           WHERE end_timestamp >= ?`,
        )
        .run(req.sinceTs)
      for (const table of SNAPSHOT_TABLES) {
        out.exec(`CREATE TABLE main.${table} AS SELECT * FROM src.${table}`)
      }
    })()
    out.exec('DETACH DATABASE src')
  } finally {
    out.close()
  }
  return zlib.gzipSync(fs.readFileSync(req.outPath))
}

export function compactSnapshotSync(req: SnapshotRequest): Buffer {
  const db = new Database(req.path)
  try {
    db.exec('VACUUM')
  } finally {
    db.close()
  }
  return zlib.gzipSync(fs.readFileSync(req.path))
}

export function prepareUploadSync(req: UploadPrepRequest): Buffer {
  return req.kind === 'delta' ? buildDeltaSync(req) : compactSnapshotSync(req)
}

interface ParentPortLike {
  on(event: 'message', listener: (e: { data: UploadPrepRequest }) => void): void
  postMessage(message: UploadPrepResponse | WorkerLogEvent, transfer?: ArrayBuffer[]): void
}
const parentPort = process.parentPort as ParentPortLike | undefined
if (parentPort) {
  forwardLogsToParent(parentPort)
  parentPort.on('message', ({ data }) => {
    try {
      const gzip = prepareUploadSync(data)
      const ab = new ArrayBuffer(gzip.byteLength)
      new Uint8Array(ab).set(gzip)
      parentPort.postMessage({ ok: true, gzip: ab }, [ab])
    } catch (err) {
      parentPort.postMessage({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })
}
