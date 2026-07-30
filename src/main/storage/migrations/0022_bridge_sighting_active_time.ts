import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

/**
 * The 300000 threshold is inlined rather than imported from
 * SIGHTING_BRIDGE_MAX_GAP_MS so tuning that constant can never change what this
 * migration did; a new threshold needs a new migration.
 */
export const migration: Migration = {
  name: '0022_bridge_sighting_active_time',
  up(db: Database.Database): void {
    db.exec(`
      WITH cited AS (
        SELECT s.id AS sid, j.value AS aid
        FROM sightings s,
             json_each(CASE WHEN json_valid(s.activity_ids) THEN s.activity_ids ELSE '[]' END) j
      ),
      cited_counts AS (
        SELECT sid, COUNT(*) AS n FROM cited GROUP BY sid
      ),
      intervals AS (
        SELECT c.sid AS sid,
               a.start_timestamp AS st,
               MAX(a.start_timestamp, a.end_timestamp) AS en
        FROM cited c
        JOIN activities a ON a.id = c.aid
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
      resolved_counts AS (
        SELECT sid, COUNT(*) AS n FROM intervals GROUP BY sid
      ),
      totals AS (
        SELECT b.sid AS sid, ROUND(SUM(b.block_end - b.block_start) / 60000.0, 1) AS mins
        FROM blocks b
        JOIN resolved_counts r ON r.sid = b.sid
        JOIN cited_counts c ON c.sid = b.sid AND c.n = r.n
        GROUP BY b.sid
      )
      UPDATE sightings
      SET interaction_min = (SELECT mins FROM totals WHERE totals.sid = sightings.id)
      WHERE EXISTS (SELECT 1 FROM totals WHERE totals.sid = sightings.id);
    `)
  },
}
