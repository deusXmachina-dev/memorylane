import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

/**
 * Recompute `sightings.interaction_min` as a gap-bridged union of the cited
 * activities' intervals: gaps up to 5 minutes are counted, longer ones are not.
 * Existing rows hold a zero-tolerance union, which drops every think and read
 * pause because an activity window closes after 5s of silence.
 *
 * The 5-minute threshold is inlined rather than imported so tuning
 * SIGHTING_BRIDGE_MAX_GAP_MS never changes what this migration did; a new
 * threshold needs a new migration. Sightings whose activities are gone keep
 * their old value.
 */
export const migration: Migration = {
  name: '0022_bridge_sighting_active_time',
  up(db: Database.Database): void {
    db.exec(`
      WITH intervals AS (
        SELECT s.id AS sid,
               a.start_timestamp AS st,
               MAX(a.start_timestamp, a.end_timestamp) AS en
        FROM sightings s
        JOIN json_each(s.activity_ids) j
        JOIN activities a ON a.id = j.value
      ),
      prefixed AS (
        SELECT sid, st, en,
               MAX(en) OVER (
                 PARTITION BY sid ORDER BY st
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ) AS prev_end
        FROM intervals
      ),
      marked AS (
        SELECT sid, st, en,
               CASE WHEN prev_end IS NULL OR st <= prev_end + 300000 THEN 0 ELSE 1 END AS breaks
        FROM prefixed
      ),
      grouped AS (
        SELECT sid, st, en,
               SUM(breaks) OVER (
                 PARTITION BY sid ORDER BY st
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
               ) AS block
        FROM marked
      ),
      blocks AS (
        SELECT sid, block, MIN(st) AS block_start, MAX(en) AS block_end
        FROM grouped GROUP BY sid, block
      ),
      totals AS (
        SELECT sid, ROUND(SUM(block_end - block_start) / 60000.0, 1) AS mins
        FROM blocks GROUP BY sid
      )
      UPDATE sightings
      SET interaction_min = (SELECT mins FROM totals WHERE totals.sid = sightings.id)
      WHERE EXISTS (SELECT 1 FROM totals WHERE totals.sid = sightings.id);
    `)
  },
}
