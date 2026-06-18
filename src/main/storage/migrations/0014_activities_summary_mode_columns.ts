import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

export const migration: Migration = {
  name: '0014_activities_summary_mode_columns',
  up(db: Database.Database): void {
    // Persist HOW each activity was summarized (video vs snapshot vs passive) and
    // WHY that mode was chosen, mirroring the existing summary_model column. This
    // turns "why did this fall back to the snapshot model?" into a GROUP BY
    // instead of log archaeology.
    db.exec(`ALTER TABLE activities ADD COLUMN summary_mode TEXT NOT NULL DEFAULT ''`)
    db.exec(`ALTER TABLE activities ADD COLUMN summary_mode_reason TEXT NOT NULL DEFAULT ''`)
    db.exec(`ALTER TABLE activities ADD COLUMN summary_failure_detail TEXT NOT NULL DEFAULT ''`)
  },
}
