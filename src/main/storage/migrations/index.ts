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
import { migration as migration0014 } from './0014_drop_activities_vector'
import { migration as migration0015 } from './0015_sighting_subject_backfill'
import { migration as migration0016 } from './0016_add_mining_days'
import { migration as migration0017 } from './0017_sighting_steps'
import { migration as migration0018 } from './0018_mining_day_cooldown'
import { migration as migration0019 } from './0019_reset_failed_mining_days'
import { migration as migration0020 } from './0020_cluster_tables'
import { migration as migration0021 } from './0021_drop_pattern_tables'
import { migration as migration0022 } from './0022_bridge_sighting_active_time'
import { migration as migration0023 } from './0023_union_sighting_active_time'

// Cluster tables hold state derived from the append-only `sightings` table and
// are fully rebuildable (rebuildClustersIfEmpty repopulates after a wipe). A
// change that invalidates existing clusters is an explicit wipe migration:
// DELETE the derived rows and let the next launch rebuild.
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
  migration0015,
  migration0016,
  migration0017,
  migration0018,
  migration0019,
  migration0020,
  migration0021,
  migration0022,
  migration0023,
]
