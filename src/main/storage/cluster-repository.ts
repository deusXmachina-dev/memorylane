import type Database from 'better-sqlite3'
import type { Sighting } from './sighting-repository'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A process candidate: a group of sightings the deterministic clusterer judged
 * to be the same recurring task. Derived and rebuilt on every clustering run —
 * stats are denormalized at build time for fast reads.
 */
export interface Cluster {
  id: string
  label: string
  description: string
  apps: string[]
  sightingCount: number
  distinctDays: number
  totalInteractionMin: number
  firstSeenAt: number
  lastSeenAt: number
  perWeek: number | null
  medoidSightingId: string
  computedAt: number
  runId: string
}

export interface ClusterMember {
  clusterId: string
  sightingId: string
}

export interface ClusterDetail {
  cluster: Cluster
  sightings: Sighting[]
}

interface GetClustersOptions {
  /** Minimum member count to surface (default 2 — singletons are never stored). */
  minSightings?: number
  /** Minimum distinct calendar days to surface (default 1). */
  minDistinctDays?: number
}

export class ClusterRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Idempotently replace all clusters and memberships in a single transaction.
   * Sightings are never touched. Called by the clusterer on every run.
   */
  replaceAll(clusters: Cluster[], members: ClusterMember[]): void {
    const tx = this.db.transaction(() => {
      this.db.exec('DELETE FROM cluster_members')
      this.db.exec('DELETE FROM clusters')

      const insertCluster = this.db.prepare(
        `INSERT INTO clusters
           (id, label, description, apps, sighting_count, distinct_days, total_interaction_min,
            first_seen_at, last_seen_at, per_week, medoid_sighting_id, computed_at, run_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const c of clusters) {
        insertCluster.run(
          c.id,
          c.label,
          c.description,
          JSON.stringify(c.apps),
          c.sightingCount,
          c.distinctDays,
          c.totalInteractionMin,
          c.firstSeenAt,
          c.lastSeenAt,
          c.perWeek,
          c.medoidSightingId,
          c.computedAt,
          c.runId,
        )
      }

      const insertMember = this.db.prepare(
        `INSERT INTO cluster_members (cluster_id, sighting_id) VALUES (?, ?)`,
      )
      for (const m of members) {
        insertMember.run(m.clusterId, m.sightingId)
      }
    })
    tx()
  }

  /** Surfaced process candidates, ranked by measured time spent. */
  getClusters(options: GetClustersOptions = {}): Cluster[] {
    const minSightings = options.minSightings ?? 2
    const minDistinctDays = options.minDistinctDays ?? 1
    const rows = this.db
      .prepare(
        `SELECT * FROM clusters
         WHERE sighting_count >= ? AND distinct_days >= ?
         ORDER BY total_interaction_min DESC`,
      )
      .all(minSightings, minDistinctDays) as Record<string, unknown>[]
    return rows.map((r) => this.rowToCluster(r))
  }

  getClusterDetail(id: string): ClusterDetail | null {
    const row = this.db.prepare(`SELECT * FROM clusters WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined
    if (!row) return null

    const sightingRows = this.db
      .prepare(
        `SELECT s.* FROM sightings s
         JOIN cluster_members m ON m.sighting_id = s.id
         WHERE m.cluster_id = ?
         ORDER BY s.started_at DESC`,
      )
      .all(id) as Record<string, unknown>[]

    return {
      cluster: this.rowToCluster(row),
      sightings: sightingRows.map((r) => this.rowToSighting(r)),
    }
  }

  getClustersForSighting(sightingId: string): Cluster[] {
    const rows = this.db
      .prepare(
        `SELECT c.* FROM clusters c
         JOIN cluster_members m ON m.cluster_id = c.id
         WHERE m.sighting_id = ?`,
      )
      .all(sightingId) as Record<string, unknown>[]
    return rows.map((r) => this.rowToCluster(r))
  }

  private rowToCluster(row: Record<string, unknown>): Cluster {
    return {
      id: row.id as string,
      label: row.label as string,
      description: row.description as string,
      apps: JSON.parse((row.apps as string) || '[]') as string[],
      sightingCount: row.sighting_count as number,
      distinctDays: row.distinct_days as number,
      totalInteractionMin: row.total_interaction_min as number,
      firstSeenAt: row.first_seen_at as number,
      lastSeenAt: row.last_seen_at as number,
      perWeek: (row.per_week as number) ?? null,
      medoidSightingId: row.medoid_sighting_id as string,
      computedAt: row.computed_at as number,
      runId: row.run_id as string,
    }
  }

  private rowToSighting(row: Record<string, unknown>): Sighting {
    return {
      id: row.id as string,
      title: row.title as string,
      description: row.description as string,
      apps: JSON.parse((row.apps as string) || '[]') as string[],
      activityIds: JSON.parse((row.activity_ids as string) || '[]') as string[],
      startedAt: row.started_at as number,
      endedAt: row.ended_at as number,
      interactionMin: row.interaction_min as number,
      confidence: row.confidence as number,
      runId: row.run_id as string,
      detectedAt: row.detected_at as number,
    }
  }
}
