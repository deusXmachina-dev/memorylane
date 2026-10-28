import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as zlib from 'zlib'
import { forwardLogsToParent, type WorkerLogEvent } from '@main/utils/worker-log'

export interface SliceRequest {
  kind: 'slice'
  dbPath: string
  outPath: string
  sinceTs: number
  pageSize: number
  includeSnapshot: boolean
}

export interface SnapshotRequest {
  kind: 'snapshot'
  path: string
}

export type UploadPrepRequest = SliceRequest | SnapshotRequest

export interface Slice {
  gzip: Buffer
  count: number
}

export type UploadPrepResponse =
  | { ok: true; gzip: ArrayBuffer; count: number }
  | { ok: false; error: string }

const ACTIVITY_COLUMNS = [
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

export function buildSliceSync(req: SliceRequest): Slice {
  const out = new Database(req.outPath)
  let count: number
  try {
    out.prepare('ATTACH DATABASE ? AS src').run(req.dbPath)
    out
      .prepare(
        `CREATE TABLE main.activities AS
         SELECT ${ACTIVITY_COLUMNS.join(', ')} FROM src.activities
         WHERE end_timestamp >= ? ORDER BY end_timestamp LIMIT ?`,
      )
      .run(req.sinceTs, req.pageSize)
    count = (out.prepare('SELECT COUNT(*) AS n FROM main.activities').get() as { n: number }).n
    if (req.includeSnapshot) {
      for (const table of SNAPSHOT_TABLES) {
        out.exec(`CREATE TABLE main.${table} AS SELECT * FROM src.${table}`)
      }
    }
    out.exec('DETACH DATABASE src')
  } finally {
    out.close()
  }
  return { gzip: zlib.gzipSync(fs.readFileSync(req.outPath)), count }
}

export function compactSnapshotSync(req: SnapshotRequest): Slice {
  const db = new Database(req.path)
  let count: number
  try {
    db.exec('VACUUM')
    count = (db.prepare('SELECT COUNT(*) AS n FROM activities').get() as { n: number }).n
  } finally {
    db.close()
  }
  return { gzip: zlib.gzipSync(fs.readFileSync(req.path)), count }
}

export function prepareUploadSync(req: UploadPrepRequest): Slice {
  return req.kind === 'slice' ? buildSliceSync(req) : compactSnapshotSync(req)
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
      const { gzip, count } = prepareUploadSync(data)
      const ab = new ArrayBuffer(gzip.byteLength)
      new Uint8Array(ab).set(gzip)
      parentPort.postMessage({ ok: true, gzip: ab, count }, [ab])
    } catch (err) {
      parentPort.postMessage({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })
}
