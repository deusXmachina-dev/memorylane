import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as zlib from 'zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSliceSync, compactSnapshotSync, type SliceRequest } from './upload-prep-worker'

describe('buildSliceSync', () => {
  const tempFiles: string[] = []

  afterEach(() => {
    for (const f of tempFiles) fs.rmSync(f, { force: true })
    tempFiles.length = 0
  })

  function tempPath(tag: string): string {
    const p = path.join(os.tmpdir(), `.slice-${tag}-${process.pid}.${Math.random()}.db`)
    tempFiles.push(p)
    return p
  }

  function makeDb(endTimestamps: number[]): string {
    const p = tempPath('src')
    const db = new Database(p)
    db.exec(`
      CREATE TABLE activities (
        id TEXT PRIMARY KEY, start_timestamp INTEGER, end_timestamp INTEGER, app_name TEXT,
        window_title TEXT, tld TEXT, summary TEXT, summary_model TEXT, ocr_text TEXT, extra TEXT
      );
      CREATE TABLE clusters (id TEXT PRIMARY KEY, label TEXT);
      CREATE TABLE cluster_sightings (sighting_id TEXT PRIMARY KEY, cluster_id TEXT);
      CREATE TABLE sightings (id TEXT PRIMARY KEY, title TEXT);
      CREATE TABLE user_context (id INTEGER PRIMARY KEY, short_summary TEXT);
      CREATE TABLE mining_days (day TEXT PRIMARY KEY);
      INSERT INTO clusters VALUES ('c1', 'Invoices');
      INSERT INTO cluster_sightings VALUES ('s1', 'c1');
      INSERT INTO sightings VALUES ('s1', 'Pay invoice');
      INSERT INTO user_context VALUES (1, 'Accountant');
    `)
    const insert = db.prepare(
      `INSERT INTO activities VALUES (?, ?, ?, 'App', 'Title', NULL, 'sum', 'm', 'ocr', 'x')`,
    )
    endTimestamps.forEach((end, i) => insert.run(`a${i}`, end - 10, end))
    db.close()
    return p
  }

  function build(req: Partial<SliceRequest> & { dbPath: string }) {
    const outPath = tempPath('out')
    const gzip = buildSliceSync({
      kind: 'slice',
      outPath,
      sinceTs: 0,
      ...req,
    })
    const unzipped = tempPath('unzipped')
    fs.writeFileSync(unzipped, zlib.gunzipSync(gzip))
    const db = new Database(unzipped, { readonly: true })
    const tables = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as {
        name: string
      }[]
    ).map((t) => t.name)
    const activities = db
      .prepare('SELECT * FROM activities ORDER BY end_timestamp')
      .all() as Record<string, unknown>[]
    db.close()
    return { tables, activities }
  }

  it('includes activities ending at or after sinceTs, with a fixed column list', () => {
    const { activities } = build({ dbPath: makeDb([100, 200, 300]), sinceTs: 200 })

    expect(activities.map((a) => a.end_timestamp)).toEqual([200, 300])
    expect(Object.keys(activities[0])).toEqual([
      'id',
      'start_timestamp',
      'end_timestamp',
      'app_name',
      'window_title',
      'tld',
      'summary',
      'summary_model',
      'ocr_text',
    ])
  })

  it('adds the full snapshot tables', () => {
    const { tables } = build({ dbPath: makeDb([100]) })

    expect(tables).toEqual([
      'activities',
      'cluster_sightings',
      'clusters',
      'sightings',
      'user_context',
    ])
  })

  it('compacts and gzips the whole database for a snapshot', () => {
    const dbPath = makeDb([100, 200])

    const gzip = compactSnapshotSync({ kind: 'snapshot', path: dbPath })

    const unzipped = tempPath('unzipped')
    fs.writeFileSync(unzipped, zlib.gunzipSync(gzip))
    const db = new Database(unzipped, { readonly: true })
    const tables = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`).get()
    db.close()
    expect(tables).toEqual({ n: 6 })
  })
})
