import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as zlib from 'zlib'
import Database from 'better-sqlite3'

// Mirrors src/main/services/strip-database-for-upload.ts
const ALWAYS_DROP_TABLES = ['pattern_detection_runs']
const SUMMARY_TRIGGERS_TO_DROP = ['activities_ai', 'activities_ad', 'activities_au']
const SUMMARY_TABLES_TO_DROP = ['activities_fts']
const SUMMARY_ACTIVITIES_COLUMNS_TO_DROP = ['ocr_text']

function stripDatabaseForUpload(dbPath, { detailLevel }) {
  const db = new Database(dbPath)
  try {
    for (const t of ALWAYS_DROP_TABLES) db.exec(`DROP TABLE IF EXISTS "${t}"`)
    if (detailLevel === 'summary') {
      for (const tr of SUMMARY_TRIGGERS_TO_DROP) db.exec(`DROP TRIGGER IF EXISTS "${tr}"`)
      for (const t of SUMMARY_TABLES_TO_DROP) db.exec(`DROP TABLE IF EXISTS "${t}"`)
      const cols = new Set(
        db
          .prepare('PRAGMA table_info(activities)')
          .all()
          .map((c) => c.name),
      )
      for (const c of SUMMARY_ACTIVITIES_COLUMNS_TO_DROP)
        if (cols.has(c)) db.exec(`ALTER TABLE activities DROP COLUMN "${c}"`)
    }
    db.exec('VACUUM')
  } finally {
    db.close()
  }
}

const src = process.argv[2]
const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB'

function run(detailLevel) {
  const tmp = path.join(os.tmpdir(), `prep-${detailLevel}-${process.pid}.db`)
  fs.copyFileSync(src, tmp)
  const copied = fs.statSync(tmp).size
  stripDatabaseForUpload(tmp, { detailLevel })
  const stripped = fs.statSync(tmp).size
  const gz = zlib.gzipSync(fs.readFileSync(tmp)).length
  fs.rmSync(tmp)
  return { detailLevel, copied, stripped, gz }
}

const original = fs.statSync(src).size
console.log(`Original on-disk DB: ${mb(original)} (${original.toLocaleString()} bytes)\n`)

for (const level of ['detailed', 'summary']) {
  const r = run(level)
  console.log(`[${r.detailLevel}]`)
  console.log(`  after strip+VACUUM: ${mb(r.stripped)}`)
  console.log(`  after gzip:         ${mb(r.gz)}  (${r.gz.toLocaleString()} bytes)`)
  console.log(
    `  gzip vs stripped:   ${(r.stripped / r.gz).toFixed(1)}x   |   upload vs original DB: ${(r.copied / r.gz).toFixed(1)}x (${((1 - r.gz / r.copied) * 100).toFixed(1)}% smaller)\n`,
  )
}
