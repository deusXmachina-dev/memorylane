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
import { migration as migration0010 } from './0010_pattern_completed_at_column'
import { migration as migration0011 } from './0011_activities_summary_model_column'
import { migration as migration0012 } from './0012_add_tasks_tables'
import { migration as migration0013 } from './0013_add_upload_runs'
import { migration as migration0014 } from './0014_activities_summary_mode_columns'

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
  migration0010,
  migration0011,
  migration0012,
  migration0013,
  migration0014,
]
