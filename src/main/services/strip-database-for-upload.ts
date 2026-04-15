import Database from 'better-sqlite3'

export interface StripOptions {
  detailLevel: 'summary' | 'detailed'
}

const ALWAYS_DROP_TABLES = ['user_context', 'pattern_detection_runs']

const SUMMARY_TRIGGERS_TO_DROP = ['activities_ai', 'activities_ad', 'activities_au']
const SUMMARY_TABLES_TO_DROP = ['activities_fts']
const SUMMARY_ACTIVITIES_COLUMNS_TO_DROP = ['ocr_text']

export function stripDatabaseForUpload(dbPath: string, options: StripOptions): void {
  const db = new Database(dbPath)
  try {
    // All identifiers are hardcoded constants — quote them defensively anyway.
    for (const table of ALWAYS_DROP_TABLES) {
      db.exec(`DROP TABLE IF EXISTS "${table}"`)
    }

    if (options.detailLevel === 'summary') {
      for (const trigger of SUMMARY_TRIGGERS_TO_DROP) {
        db.exec(`DROP TRIGGER IF EXISTS "${trigger}"`)
      }
      for (const table of SUMMARY_TABLES_TO_DROP) {
        db.exec(`DROP TABLE IF EXISTS "${table}"`)
      }
      const existingColumns = new Set(
        (db.prepare('PRAGMA table_info(activities)').all() as { name: string }[]).map(
          (c) => c.name,
        ),
      )
      for (const column of SUMMARY_ACTIVITIES_COLUMNS_TO_DROP) {
        if (existingColumns.has(column)) {
          db.exec(`ALTER TABLE activities DROP COLUMN "${column}"`)
        }
      }
    }

    db.exec('VACUUM')
  } finally {
    db.close()
  }
}
