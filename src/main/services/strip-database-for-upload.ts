import Database from 'better-sqlite3'

const TRIGGERS_TO_DROP = ['activities_ai', 'activities_ad', 'activities_au']
const TABLES_TO_DROP = ['activities_fts', 'user_context', 'pattern_detection_runs']
const ACTIVITIES_COLUMNS_TO_DROP = ['ocr_text']

export function stripDatabaseForUpload(dbPath: string): void {
  const db = new Database(dbPath)
  try {
    for (const trigger of TRIGGERS_TO_DROP) {
      db.exec(`DROP TRIGGER IF EXISTS ${trigger}`)
    }
    for (const table of TABLES_TO_DROP) {
      db.exec(`DROP TABLE IF EXISTS ${table}`)
    }
    const existingColumns = new Set(
      (db.prepare('PRAGMA table_info(activities)').all() as { name: string }[]).map((c) => c.name),
    )
    for (const column of ACTIVITIES_COLUMNS_TO_DROP) {
      if (existingColumns.has(column)) {
        db.exec(`ALTER TABLE activities DROP COLUMN ${column}`)
      }
    }
    db.exec('VACUUM')
  } finally {
    db.close()
  }
}
