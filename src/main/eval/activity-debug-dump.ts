import { StreamJsonlDumper } from '../stream-jsonl-dumper'
import type { DumpedActivity } from './types'

/**
 * Appends each activity the live pipeline summarized to `activities.jsonl`. The
 * in-app eval recorder taps the extractor's persisted-activity callback and
 * dumps a compact record (boundaries + the summary it actually produced) so the
 * promoted fixture's golden can be seeded straight from real capture-time output
 * — no replay and no DB time-overlap join. `referenceTimestamp` is the activity
 * end, so `lagMs` measures how long after an activity closed its summary landed.
 */
export class ActivityDebugDumper extends StreamJsonlDumper<DumpedActivity> {
  constructor(rootDir: string, fileName = 'activities.jsonl') {
    super(rootDir, fileName, 'ActivityDebugDumper')
  }

  protected referenceTimestamp(activity: DumpedActivity): number {
    return activity.endTimestamp
  }
}
