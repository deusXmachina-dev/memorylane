import Database from 'better-sqlite3'
import type { Migration } from '../migrator'
import { parseJsonStringArray } from '../utils'

// Self-contained on purpose: a shipped migration must keep producing the same
// numbers, so the union rule does not follow the miner's.
interface SightingRow {
  id: string
  activity_ids: string
}

interface ActivityRow {
  startTimestamp: number
  endTimestamp: number
}

function unionActiveMin(activities: ActivityRow[]): number {
  const intervals = activities
    .map((a) => ({ start: a.startTimestamp, end: Math.max(a.startTimestamp, a.endTimestamp) }))
    .sort((a, b) => a.start - b.start)
  let unionMs = 0
  let curStart = intervals[0].start
  let curEnd = intervals[0].end
  for (const { start, end } of intervals.slice(1)) {
    if (start <= curEnd) {
      curEnd = Math.max(curEnd, end)
    } else {
      unionMs += curEnd - curStart
      curStart = start
      curEnd = end
    }
  }
  unionMs += curEnd - curStart
  return Math.round((unionMs / 60_000) * 10) / 10
}

export const migration: Migration = {
  name: '0023_union_sighting_active_time',
  up(db: Database.Database): void {
    const getActivity = db.prepare<[string], ActivityRow>(
      `SELECT start_timestamp AS startTimestamp, end_timestamp AS endTimestamp
       FROM activities WHERE id = ?`,
    )
    const update = db.prepare(`UPDATE sightings SET interaction_min = ? WHERE id = ?`)
    const rows = db.prepare<[], SightingRow>(`SELECT id, activity_ids FROM sightings`).all()

    for (const row of rows) {
      const ids = parseJsonStringArray(row.activity_ids)
      if (ids.length === 0) continue
      const resolved = ids.map((id) => getActivity.get(id)).filter((a) => a !== undefined)
      if (resolved.length < ids.length) continue
      update.run(unionActiveMin(resolved), row.id)
    }
  },
}
