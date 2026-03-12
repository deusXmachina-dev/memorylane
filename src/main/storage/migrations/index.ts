import type { Migration } from '../migrator'
import { migration as migration0001 } from './0001_initial_schema'
import { migration as migration0002 } from './0002_migrate_context_events'
import { migration as migration0003 } from './0003_fts_sync_triggers'
import { migration as migration0004 } from './0004_patterns_tables'
import { migration as migration0005 } from './0005_pattern_status_columns'

export const migrations: Migration[] = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0005,
]
