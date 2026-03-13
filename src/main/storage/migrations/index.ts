import type { Migration } from '../migrator'
import { migration as migration0001 } from './0001_initial_schema'
import { migration as migration0002 } from './0002_migrate_context_events'
import { migration as migration0003 } from './0003_fts_sync_triggers'
import { migration as migration0004 } from './0004_patterns_tables'
import { migration as migration0005 } from './0005_pattern_status_columns'
import { migration as migration0006 } from './0006_pattern_approved_at_column'
import { migration as migration0007 } from './0007_user_context'
import { migration as migration0008 } from './0008_pattern_detection_runs'
import { migration as migration0009 } from './0009_pattern_duration_estimate'

export const migrations: Migration[] = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0005,
  migration0006,
  migration0007,
  migration0008,
  migration0009,
]
