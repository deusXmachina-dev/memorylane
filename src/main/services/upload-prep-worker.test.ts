import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as zlib from 'zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareUploadSync } from './upload-prep-worker'

describe('prepareUploadSync', () => {
  const tempFiles: string[] = []

  afterEach(() => {
    for (const f of tempFiles) fs.rmSync(f, { force: true })
    tempFiles.length = 0
  })

  function makeDb(): string {
    const p = path.join(os.tmpdir(), `.prep-test-${process.pid}.${Math.random()}.db`)
    tempFiles.push(p)
    const db = new Database(p)
    db.exec('CREATE TABLE activities (id TEXT PRIMARY KEY, title TEXT, ocr_text TEXT)')
    db.exec('CREATE TABLE pattern_detection_runs (id INTEGER PRIMARY KEY)')
    db.prepare('INSERT INTO activities VALUES (?, ?, ?)').run('a1', 'one', 'ocr one')
    db.prepare('INSERT INTO activities VALUES (?, ?, ?)').run('a2', 'two', 'ocr two')
    db.prepare('INSERT INTO pattern_detection_runs (id) VALUES (1)').run()
    db.close()
    return p
  }

  it('strips sensitive tables/columns and returns gzip bytes that round-trip', () => {
    const dbPath = makeDb()

    const gz = prepareUploadSync(dbPath, { detailLevel: 'summary' })

    // Output is real gzip…
    expect(gz[0]).toBe(0x1f)
    expect(gz[1]).toBe(0x8b)

    // …and inflates to a valid SQLite DB with the sensitive bits removed.
    const outPath = path.join(os.tmpdir(), `.prep-out-${process.pid}.${Math.random()}.db`)
    tempFiles.push(outPath)
    fs.writeFileSync(outPath, zlib.gunzipSync(gz))

    const db = new Database(outPath, { readonly: true })
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => (r as { name: string }).name)
      expect(tables).not.toContain('pattern_detection_runs')

      const cols = (db.prepare('PRAGMA table_info(activities)').all() as { name: string }[]).map(
        (c) => c.name,
      )
      expect(cols).not.toContain('ocr_text')

      // Activity rows themselves are preserved.
      expect((db.prepare('SELECT COUNT(*) AS n FROM activities').get() as { n: number }).n).toBe(2)
    } finally {
      db.close()
    }
  })
})
