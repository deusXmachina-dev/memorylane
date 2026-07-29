import type Database from 'better-sqlite3'
import type { Sighting } from './sighting-repository'
import { rowToSighting } from './sighting-repository'
import { parseJsonStringArray, vectorToBlob, blobToVector } from './utils'

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
  /**
   * Consolidated "Replace with" recommendation. On a labeled cluster, '' means
   * the review judged it not automatable.
   */
  mechanism: string
  /** Generalized, de-identified recipe steps (the "Build AI agent" recipe); [] until labeled. */
  steps: string[]
  /** Things that differ between runs (feeds the recipe); [] until labeled. */
  variables: string[]
  /** Member count at the last labeling — relabel once the cluster doubles. */
  labeledSize: number
  createdAt: number
}

/** The generalized, sanitized recipe for a cluster, written by the review LLM. */
export interface ClusterRecipe {
  steps: string[]
  variables: string[]
}

/** Canonical key for an unordered cluster pair — the one format shared by
 * merge-candidate guards and the decline store. */
export function mergePairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export class ClusterRepository {
  constructor(private readonly db: Database.Database) {}

  // -------------------------------------------------------------------------
  // Signatures
  // -------------------------------------------------------------------------

  /** Record a sighting's signature. NULL embedding = processed but unusable. */
  upsertSignature(sightingId: string, embedding: number[] | null): void {
    this.db
      .prepare(
        `INSERT INTO sighting_signatures (sighting_id, embedding)
         VALUES (?, ?)
         ON CONFLICT(sighting_id) DO UPDATE SET embedding = excluded.embedding`,
      )
      .run(sightingId, embedding ? vectorToBlob(embedding) : null)
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
    return rows.map((r) => rowToSighting(r))
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
        `INSERT INTO clusters (id, label, description, centroid, mechanism,
                               steps, variables, labeled_size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        cluster.id,
        cluster.label,
        cluster.description,
        cluster.centroid ? vectorToBlob(cluster.centroid) : null,
        cluster.mechanism,
        JSON.stringify(cluster.steps),
        JSON.stringify(cluster.variables),
        cluster.labeledSize,
        cluster.createdAt,
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

  /** Labels of reviewed clusters that have recurred, with their member counts. */
  getRecurringLabels(): { label: string; timesSeen: number }[] {
    return this.db
      .prepare(
        `SELECT c.label AS label, COUNT(cs.sighting_id) AS timesSeen
         FROM clusters c
         JOIN cluster_sightings cs ON cs.cluster_id = c.id
         WHERE c.label != ''
         GROUP BY c.id
         HAVING COUNT(cs.sighting_id) >= 2`,
      )
      .all() as { label: string; timesSeen: number }[]
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
    return rows.map((r) => rowToSighting(r))
  }

  getMemberCount(clusterId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM cluster_sightings WHERE cluster_id = ?`)
      .get(clusterId) as { count: number }
    return row.count
  }

  /**
   * Lightweight per-member rows across all clusters in one query — used to
   * derive recurrence buckets, duration stats, apps, and title fallbacks
   * without an N+1.
   */
  getMemberDigest(): {
    clusterId: string
    startedAt: number
    endedAt: number
    activeMin: number
    title: string
    apps: string[]
    steps: string[]
  }[] {
    const rows = this.db
      .prepare(
        `SELECT cs.cluster_id AS clusterId, s.started_at AS startedAt,
                s.ended_at AS endedAt, s.interaction_min AS activeMin,
                s.title AS title, s.apps AS apps, s.steps AS steps
         FROM cluster_sightings cs
         JOIN sightings s ON s.id = cs.sighting_id
         ORDER BY s.started_at ASC`,
      )
      .all() as {
      clusterId: string
      startedAt: number
      endedAt: number
      activeMin: number
      title: string
      apps: string
      steps: string
    }[]
    return rows.map((r) => ({
      ...r,
      apps: JSON.parse(r.apps || '[]') as string[],
      steps: parseJsonStringArray(r.steps),
    }))
  }

  addMembership(clusterId: string, sightingId: string): void {
    this.db
      .prepare(
        `INSERT INTO cluster_sightings (sighting_id, cluster_id)
         VALUES (?, ?)
         ON CONFLICT(sighting_id) DO UPDATE SET cluster_id = excluded.cluster_id`,
      )
      .run(sightingId, clusterId)
  }

  moveMemberships(fromClusterId: string, toClusterId: string): number {
    return this.db
      .prepare(`UPDATE cluster_sightings SET cluster_id = ? WHERE cluster_id = ?`)
      .run(toClusterId, fromClusterId).changes
  }

  updateCentroid(clusterId: string, centroid: number[] | null): void {
    this.db
      .prepare(`UPDATE clusters SET centroid = ? WHERE id = ?`)
      .run(centroid ? vectorToBlob(centroid) : null, clusterId)
  }

  /** `mechanism: null` leaves the stored mechanism untouched (relabel that
   * omitted the classification must not wipe an earlier judgment). */
  updateLabel(
    clusterId: string,
    label: string,
    description: string,
    mechanism: string | null,
    labeledSize: number,
  ): void {
    this.db
      .prepare(
        `UPDATE clusters
         SET label = ?, description = ?, mechanism = COALESCE(?, mechanism), labeled_size = ?
         WHERE id = ?`,
      )
      .run(label, description, mechanism, labeledSize, clusterId)
  }

  updateRecipe(clusterId: string, recipe: ClusterRecipe): void {
    this.db
      .prepare(
        `UPDATE clusters
         SET steps = ?, variables = ?
         WHERE id = ?`,
      )
      .run(JSON.stringify(recipe.steps), JSON.stringify(recipe.variables), clusterId)
  }

  /**
   * Clear all derived cluster state — clusters, memberships, signatures, and
   * the merge-decline ledger. Sightings are untouched; re-mining rebuilds
   * these. Backs the dev "wipe & re-mine" action.
   */
  deleteAll(): void {
    this.db.exec(`
      DELETE FROM cluster_sightings;
      DELETE FROM cluster_merge_declines;
      DELETE FROM clusters;
      DELETE FROM sighting_signatures;
    `)
  }

  /** Delete a cluster and its memberships (member sightings are untouched). */
  delete(clusterId: string): void {
    this.db.prepare(`DELETE FROM cluster_sightings WHERE cluster_id = ?`).run(clusterId)
    this.db
      .prepare(`DELETE FROM cluster_merge_declines WHERE cluster_a = ? OR cluster_b = ?`)
      .run(clusterId, clusterId)
    this.db.prepare(`DELETE FROM clusters WHERE id = ?`).run(clusterId)
  }

  // -------------------------------------------------------------------------
  // Merge declines
  // -------------------------------------------------------------------------

  /** Record that the review LLM saw this merge candidate pair and passed. */
  recordMergeDecline(a: string, b: string, declinedAt: number): void {
    const [first, second] = a < b ? [a, b] : [b, a]
    this.db
      .prepare(
        `INSERT INTO cluster_merge_declines (cluster_a, cluster_b, declined_at)
         VALUES (?, ?, ?)
         ON CONFLICT(cluster_a, cluster_b) DO UPDATE SET declined_at = excluded.declined_at`,
      )
      .run(first, second, declinedAt)
  }

  /** mergePairKey()s of pairs declined at or after `since`. */
  getActiveMergeDeclines(since: number): Set<string> {
    const rows = this.db
      .prepare(`SELECT cluster_a, cluster_b FROM cluster_merge_declines WHERE declined_at >= ?`)
      .all(since) as { cluster_a: string; cluster_b: string }[]
    return new Set(rows.map((r) => mergePairKey(r.cluster_a, r.cluster_b)))
  }

  /**
   * Signatures with no cluster membership, keyed by sighting id. Normally the
   * sightings signed this run; also heals sightings stranded by a crash
   * between signing and grouping on an earlier run.
   */
  getUnattachedSignatures(): Map<string, number[]> {
    const rows = this.db
      .prepare(
        `SELECT ss.sighting_id, ss.embedding FROM sighting_signatures ss
         LEFT JOIN cluster_sightings cs ON cs.sighting_id = ss.sighting_id
         WHERE cs.sighting_id IS NULL AND ss.embedding IS NOT NULL`,
      )
      .all() as { sighting_id: string; embedding: Buffer }[]
    const result = new Map<string, number[]>()
    for (const row of rows) result.set(row.sighting_id, blobToVector(row.embedding))
    return result
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

    this.db
      .prepare(
        `DELETE FROM cluster_merge_declines
         WHERE cluster_a NOT IN (SELECT id FROM clusters)
            OR cluster_b NOT IN (SELECT id FROM clusters)`,
      )
      .run()

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
      mechanism: row.mechanism as string,
      steps: parseJsonStringArray(row.steps),
      variables: parseJsonStringArray(row.variables),
      labeledSize: row.labeled_size as number,
      createdAt: row.created_at as number,
    }
  }
}
