import Database from 'better-sqlite3'
import { computeEpisodeWindow } from '@main/services/task-miner/helpers'
import type { Migration } from '../migrator'

/**
 * Re-derives `interaction_min` as the gap-bridged union of each sighting's
 * cited activities. The threshold is inlined rather than read from
 * SIGHTING_BRIDGE_MAX_GAP_MS so tuning that constant can never change what this
 * migration did; a new threshold needs a new migration.
 */
const MAX_GAP_MS = 300_000

interface SightingRow {
  id: string
  activity_ids: string
}

interface ActivityRow {
  startTimestamp: number
  endTimestamp: number
}

export const migration: Migration = {
  name: '0022_bridge_sighting_active_time',
  up(db: Database.Database): void {
    const getActivity = db.prepare(
      `SELECT start_timestamp AS startTimestamp, end_timestamp AS endTimestamp
       FROM activities WHERE id = ?`,
    )
    const update = db.prepare(`UPDATE sightings SET interaction_min = ? WHERE id = ?`)
    const rows = db.prepare(`SELECT id, activity_ids FROM sightings`).all() as SightingRow[]

    db.transaction(() => {
      for (const row of rows) {
        let ids: unknown
        try {
          ids = JSON.parse(row.activity_ids || '[]')
        } catch {
          continue
        }
        if (!Array.isArray(ids) || ids.length === 0) continue
        const resolved = ids.map((id) => getActivity.get(id) as ActivityRow | undefined)
        if (resolved.some((a) => a === undefined)) continue
        update.run(computeEpisodeWindow(resolved as ActivityRow[], MAX_GAP_MS).activeMin, row.id)
      }
    })()
  },
}
