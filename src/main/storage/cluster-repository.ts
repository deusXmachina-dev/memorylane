import type Database from 'better-sqlite3'
import type { Sighting } from './sighting-repository'
import { vectorToBlob, blobToVector } from './utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A recurring process derived from sightings. Unlike sightings, clusters are
 * mutable and rebuildable — but their ids are stable across runs so recurrence
 * counts can grow over time. `label === ''` means not yet LLM-labeled; readers
 * fall back to the most common member title.
 */
export interface Cluster {
  id: string
  label: string
  description: string
  /** Unit-normalized mean of member signatures; null until first computed. */
  centroid: number[] | null
  labelModel: string
  /** Member count at the last labeling — relabel once the cluster doubles. */
  labeledSize: number
  createdAt: number
  updatedAt: number
}

/** Cluster plus stats computed on read from member sightings (never stored). */
export interface ClusterWithStats extends Cluster {
  timesSeen: number
  avgInteractionMin: number
  firstSeenAt: number | null
  lastSeenAt: number | null
  apps: string[]
}

export class ClusterRepository {
  constructor(private readonly db: Database.Database) {}

  // -------------------------------------------------------------------------
  // Signatures
  // -------------------------------------------------------------------------

  /** Record a sighting's signature. NULL embedding = processed but unusable. */
  upsertSignature(sightingId: string, embedding: number[] | null, computedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO sighting_signatures (sighting_id, embedding, computed_at)
         VALUES (?, ?, ?)
         ON CONFLICT(sighting_id) DO UPDATE SET embedding = excluded.embedding,
                                                computed_at = excluded.computed_at`,
      )
      .run(sightingId, embedding ? vectorToBlob(embedding) : null, computedAt)
  }

  /** Sightings that have never been through the clusterer. */
  getUnprocessedSightings(): Sighting[] {
    const rows = this.db
      .prepare(
        `SELECT s.* FROM sightings s
         LEFT JOIN sighting_signatures ss ON ss.sighting_id = s.id
         WHERE ss.sighting_id IS NULL
         ORDER BY s.started_at ASC`,
      )
      .all() as Record<string, unknown>[]
    return rows.map((r) => this.rowToSighting(r))
  }

  /** Non-null signatures of a cluster's members, keyed by sighting id. */
  getSignaturesByClusterId(clusterId: string): Map<string, number[]> {
    const rows = this.db
      .prepare(
        `SELECT ss.sighting_id, ss.embedding
         FROM cluster_sightings cs
         JOIN sighting_signatures ss ON ss.sighting_id = cs.sighting_id
         WHERE cs.cluster_id = ? AND ss.embedding IS NOT NULL`,
      )
      .all(clusterId) as { sighting_id: string; embedding: Buffer }[]

    const result = new Map<string, number[]>()
    for (const row of rows) {
      result.set(row.sighting_id, blobToVector(row.embedding))
    }
    return result
  }

  // -------------------------------------------------------------------------
  // Clusters
  // -------------------------------------------------------------------------

  create(cluster: Cluster): void {
    this.db
      .prepare(
        `INSERT INTO clusters (id, label, description, centroid, label_model, labeled_size, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        cluster.id,
        cluster.label,
        cluster.description,
        cluster.centroid ? vectorToBlob(cluster.centroid) : null,
        cluster.labelModel,
        cluster.labeledSize,
        cluster.createdAt,
        cluster.updatedAt,
      )
  }

  getById(id: string): Cluster | null {
    const row = this.db.prepare(`SELECT * FROM clusters WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined
    return row ? this.rowToCluster(row) : null
  }

  getAll(): Cluster[] {
    const rows = this.db.prepare(`SELECT * FROM clusters ORDER BY created_at ASC`).all() as Record<
      string,
      unknown
    >[]
    return rows.map((r) => this.rowToCluster(r))
  }

  getAllWithStats(): ClusterWithStats[] {
    const rows = this.db
      .prepare(
        `SELECT c.*,
                COUNT(cs.sighting_id) AS times_seen,
                AVG(s.interaction_min) AS avg_interaction_min,
                MIN(s.started_at) AS first_seen_at,
                MAX(s.ended_at) AS last_seen_at
         FROM clusters c
         LEFT JOIN cluster_sightings cs ON cs.cluster_id = c.id
         LEFT JOIN sightings s ON s.id = cs.sighting_id
         GROUP BY c.id
         ORDER BY times_seen DESC, c.created_at ASC`,
      )
      .all() as Record<string, unknown>[]

    const appsRows = this.db
      .prepare(
        `SELECT cs.cluster_id, s.apps FROM cluster_sightings cs
         JOIN sightings s ON s.id = cs.sighting_id`,
      )
      .all() as { cluster_id: string; apps: string }[]
    const appsByCluster = new Map<string, Set<string>>()
    for (const row of appsRows) {
      let set = appsByCluster.get(row.cluster_id)
      if (!set) {
        set = new Set()
        appsByCluster.set(row.cluster_id, set)
      }
      for (const app of JSON.parse(row.apps || '[]') as string[]) set.add(app)
    }

    return rows.map((row) => ({
      ...this.rowToCluster(row),
      timesSeen: (row.times_seen as number) ?? 0,
      avgInteractionMin: (row.avg_interaction_min as number) ?? 0,
      firstSeenAt: (row.first_seen_at as number) ?? null,
      lastSeenAt: (row.last_seen_at as number) ?? null,
      apps: [...(appsByCluster.get(row.id as string) ?? [])],
    }))
  }

  /** Member sightings ordered by start time. */
  getMembers(clusterId: string): Sighting[] {
    const rows = this.db
      .prepare(
        `SELECT s.* FROM cluster_sightings cs
         JOIN sightings s ON s.id = cs.sighting_id
         WHERE cs.cluster_id = ?
         ORDER BY s.started_at ASC`,
      )
      .all(clusterId) as Record<string, unknown>[]
    return rows.map((r) => this.rowToSighting(r))
  }

  getMemberCount(clusterId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM cluster_sightings WHERE cluster_id = ?`)
      .get(clusterId) as { count: number }
    return row.count
  }

  addMembership(clusterId: string, sightingId: string, addedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO cluster_sightings (sighting_id, cluster_id, added_at)
         VALUES (?, ?, ?)
         ON CONFLICT(sighting_id) DO UPDATE SET cluster_id = excluded.cluster_id,
                                                added_at = excluded.added_at`,
      )
      .run(sightingId, clusterId, addedAt)
  }

  moveMemberships(fromClusterId: string, toClusterId: string): number {
    return this.db
      .prepare(`UPDATE cluster_sightings SET cluster_id = ? WHERE cluster_id = ?`)
      .run(toClusterId, fromClusterId).changes
  }

  updateCentroid(clusterId: string, centroid: number[] | null, updatedAt: number): void {
    this.db
      .prepare(`UPDATE clusters SET centroid = ?, updated_at = ? WHERE id = ?`)
      .run(centroid ? vectorToBlob(centroid) : null, updatedAt, clusterId)
  }

  updateLabel(
    clusterId: string,
    label: string,
    description: string,
    labelModel: string,
    labeledSize: number,
    updatedAt: number,
  ): void {
    this.db
      .prepare(
        `UPDATE clusters
         SET label = ?, description = ?, label_model = ?, labeled_size = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(label, description, labelModel, labeledSize, updatedAt, clusterId)
  }

  /** Delete a cluster and its memberships (member sightings are untouched). */
  delete(clusterId: string): void {
    this.db.prepare(`DELETE FROM cluster_sightings WHERE cluster_id = ?`).run(clusterId)
    this.db.prepare(`DELETE FROM clusters WHERE id = ?`).run(clusterId)
  }

  // -------------------------------------------------------------------------
  // Consistency
  // -------------------------------------------------------------------------

  /**
   * Drop memberships/signatures for sightings that no longer exist (pruned),
   * then delete clusters left with zero members. Returns touched cluster ids
   * so the caller can recompute their centroids.
   */
  pruneOrphans(): {
    droppedMemberships: number
    droppedSignatures: number
    deletedClusters: number
    touchedClusterIds: string[]
  } {
    const orphanRows = this.db
      .prepare(
        `SELECT DISTINCT cluster_id FROM cluster_sightings
         WHERE sighting_id NOT IN (SELECT id FROM sightings)`,
      )
      .all() as { cluster_id: string }[]
    const touched = orphanRows.map((r) => r.cluster_id)

    const droppedMemberships = this.db
      .prepare(`DELETE FROM cluster_sightings WHERE sighting_id NOT IN (SELECT id FROM sightings)`)
      .run().changes
    const droppedSignatures = this.db
      .prepare(
        `DELETE FROM sighting_signatures WHERE sighting_id NOT IN (SELECT id FROM sightings)`,
      )
      .run().changes

    const emptyRows = this.db
      .prepare(
        `SELECT id FROM clusters
         WHERE id NOT IN (SELECT DISTINCT cluster_id FROM cluster_sightings)`,
      )
      .all() as { id: string }[]
    for (const row of emptyRows) {
      this.db.prepare(`DELETE FROM clusters WHERE id = ?`).run(row.id)
    }
    const deletedIds = new Set(emptyRows.map((r) => r.id))

    return {
      droppedMemberships,
      droppedSignatures,
      deletedClusters: deletedIds.size,
      touchedClusterIds: touched.filter((id) => !deletedIds.has(id)),
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private rowToCluster(row: Record<string, unknown>): Cluster {
    return {
      id: row.id as string,
      label: row.label as string,
      description: row.description as string,
      centroid: row.centroid ? blobToVector(row.centroid as Buffer) : null,
      labelModel: row.label_model as string,
      labeledSize: row.labeled_size as number,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
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
      runId: row.run_id as string,
      detectedAt: row.detected_at as number,
    }
  }
}
