/**
 * Persistent, incremental clustering over task-miner sightings.
 *
 * Sightings are carved in stone; everything here is a derived, rebuildable
 * view — but cluster ids are STABLE across runs, so "seen X times" grows week
 * over week. Deterministic-first: signatures, centroid attachment,
 * average-linkage grouping, and all stats are pure computation; the LLM only
 * writes labels/descriptions and adjudicates merge/split proposals over groups
 * it is shown. Identity repair is bounded and deterministic: a split keeps the
 * original id on the largest group, dissonant members are evicted after
 * centroid refreshes, and a cluster that falls below the coherence floor is
 * re-offered for splitting no matter when it was born. LLM failure degrades to
 * unlabeled clusters that are retried on the next run.
 */

import { v4 as uuidv4 } from 'uuid'
import type { StorageService } from '@main/storage'
import type { Cluster } from '@main/storage/cluster-repository'
import type { InferenceProvider } from '@main/llm'
import log from '@main/utils/logger'
import { formatApiError } from '../../pattern-detector/helpers'
import type { ProgressCallback } from '../types'
import { dot } from './vector-math'
import {
  computeAndStoreSignatures,
  memberSimilarities,
  recomputeCentroid,
  type SignatureEmbedder,
} from './signatures'
import { attachToCentroids, averageLinkageGroups, type SightingSignature } from './attach'
import type { ClusteringRunSummary, ReviewCluster, ReviewInput } from './types'
import { CLUSTERING_CONFIG, emptyClusteringSummary } from './types'
import { runLlmReview, type ReviewCallResult } from './llm-review'
import { validateAndApply, mergePairKey, type ReviewGuards } from './apply-review'

export type { ClusteringRunSummary } from './types'
export { CLUSTERING_CONFIG } from './types'

export interface ClusteringDeps {
  storage: StorageService
  /** Embeds sightings' title+description into the signature space. */
  embedder: SignatureEmbedder
  /**
   * Off-main-thread average-linkage over raw vectors (the ml-worker). Only
   * the first-cut grouping uses it — that pass sees the whole backlog on
   * bootstrap. Absent → in-process (tests, CLI scripts under enode).
   */
  clusterVectors?: (
    vectors: readonly (readonly number[])[],
    threshold: number,
  ) => Promise<number[][]>
  /** Absent → deterministic steps only (offline / tests). */
  provider?: InferenceProvider
  model: string
  now?: number
  onProgress?: ProgressCallback
  /** Injectable LLM step for tests; defaults to the real review call. */
  review?: (input: ReviewInput) => Promise<ReviewCallResult>
}

export async function runClustering(deps: ClusteringDeps): Promise<ClusteringRunSummary> {
  const { storage, provider, model } = deps
  const now = deps.now ?? Date.now()
  const summary = emptyClusteringSummary()

  const progress = (msg: string) => {
    log.info(`[TaskMiner] ${msg}`)
    deps.onProgress?.(msg)
  }

  // 1. Consistency: drop memberships/signatures of pruned sightings, delete
  //    emptied clusters, refresh centroids of clusters that lost members.
  const pruned = storage.clusters.pruneOrphans()
  if (pruned.droppedMemberships || pruned.deletedClusters) {
    progress(
      `[Clustering] Pruned ${pruned.droppedMemberships} memberships, ` +
        `deleted ${pruned.deletedClusters} empty clusters`,
    )
  }
  for (const clusterId of pruned.touchedClusterIds) recomputeCentroid(storage, clusterId, now)

  // 2. Signatures for sightings never seen by the clusterer. On the first run
  //    after the migration this is the whole retained backlog — bootstrap is
  //    the same code path.
  const unprocessed = storage.clusters.getUnprocessedSightings()
  const { unclustered } = await computeAndStoreSignatures(storage, unprocessed, deps.embedder, now)
  summary.newSignatures = unprocessed.length
  summary.unclustered = unclustered

  // Work from the store, not this call's return value: signatures persisted
  // by a run that crashed before grouping are picked up here instead of being
  // orphaned forever (getUnprocessedSightings would never re-see them).
  const signatures: SightingSignature[] = [...storage.clusters.getUnattachedSignatures()].map(
    ([sightingId, vector]) => ({ sightingId, vector }),
  )
  if (signatures.length === 0 && pruned.touchedClusterIds.length === 0) {
    return summary
  }
  progress(
    `[Clustering] ${unprocessed.length} new sightings ` +
      `(${signatures.length} to cluster, ${unclustered} without signatures)`,
  )

  // 3. Attach to existing clusters by centroid similarity. Centroids are
  //    frozen for the whole pass so results don't depend on sighting order.
  const existing = storage.clusters.getAll()
  const centroids = existing
    .filter((c): c is Cluster & { centroid: number[] } => c.centroid !== null)
    .map((c) => ({ clusterId: c.id, centroid: c.centroid }))
  const { attached, leftovers } = attachToCentroids(
    signatures,
    centroids,
    CLUSTERING_CONFIG.SIMILARITY_THRESHOLD,
  )
  const touched = new Set<string>(pruned.touchedClusterIds)
  for (const { sightingId, clusterId } of attached) {
    storage.clusters.addMembership(clusterId, sightingId, now)
    touched.add(clusterId)
  }
  summary.attached = attached.length

  // 4. First-cut grouping of what didn't attach anywhere. Every group —
  //    singletons included — becomes a cluster, so recurrence can grow from 1.
  const groups = deps.clusterVectors
    ? (
        await deps.clusterVectors(
          leftovers.map((l) => l.vector),
          CLUSTERING_CONFIG.SIMILARITY_THRESHOLD,
        )
      ).map((group) => group.map((i) => leftovers[i].sightingId))
    : averageLinkageGroups(leftovers, CLUSTERING_CONFIG.SIMILARITY_THRESHOLD)
  const newClusterIds = new Set<string>()
  for (const group of groups) {
    const clusterId = uuidv4()
    createUnlabeledCluster(storage, clusterId, null, now)
    for (const sightingId of group) storage.clusters.addMembership(clusterId, sightingId, now)
    newClusterIds.add(clusterId)
    touched.add(clusterId)
  }
  summary.newClusters = newClusterIds.size

  // 5. Refresh centroids of every touched cluster, then evict members that a
  //    merge or pruning has left far from their own centroid — the repair
  //    valve for "member for life" drift. Evictees become their own clusters.
  for (const clusterId of touched) recomputeCentroid(storage, clusterId, now)
  summary.evicted = evictDissonantMembers(storage, touched, newClusterIds, now)
  if (attached.length || newClusterIds.size || summary.evicted) {
    progress(
      `[Clustering] Attached ${attached.length} sightings to existing clusters, ` +
        `created ${newClusterIds.size} new clusters, evicted ${summary.evicted} members`,
    )
  }

  // 6. LLM review: label new/grown clusters, adjudicate merges among
  //    near-threshold centroid pairs, split clusters that are new or fell
  //    below the coherence floor.
  const input = buildReviewInput(storage, touched, newClusterIds, now)
  if (input.clusters.length === 0) return summary
  if (!provider) {
    progress('[Clustering] No inference provider — skipping LLM review')
    return summary
  }

  try {
    const review = deps.review
      ? await deps.review(input)
      : await runLlmReview(provider, model, input, progress)
    summary.tokenUsage = review.tokenUsage
    if (!review.output) {
      summary.llmError = 'Could not parse review response'
      return summary
    }

    const guards: ReviewGuards = {
      reviewableIds: new Set(input.clusters.map((c) => c.id)),
      splittableIds: new Set(input.clusters.filter((c) => c.splittable).map((c) => c.id)),
      mergeCandidatePairs: new Set(input.mergeCandidates.map(([a, b]) => mergePairKey(a, b))),
    }
    const applied = validateAndApply(storage, review.output, guards, model, now, progress)
    summary.merged = applied.merged
    summary.split = applied.split
    summary.labeled = applied.labeled
    progress(
      `[Clustering] Review applied: ${applied.labeled} labeled, ` +
        `${applied.merged} merged, ${applied.split} split`,
    )
  } catch (error) {
    summary.llmError = formatApiError(error)
    log.error('[TaskMiner] Clustering LLM review failed:', summary.llmError)
  }

  return summary
}

/**
 * Move members whose signature no longer clears EVICTION_THRESHOLD against
 * their own cluster's centroid into fresh singleton clusters. Scans every
 * cluster — drift comes from merges and pruning, which land after this step
 * runs, so limiting to this run's touched set would miss them. Clusters born
 * this run are skipped: average-linkage admits by group mean, so a marginal
 * member is not drift — the LLM reviews the group as formed. The best-fitting
 * member always stays, so a cluster is never emptied. Each eviction records a
 * merge decline against the old cluster, or the next review would just
 * re-propose gluing the evictee back on. Capped per run; anything left
 * drifted is caught on a later run.
 */
function evictDissonantMembers(
  storage: StorageService,
  touched: Set<string>,
  newClusterIds: ReadonlySet<string>,
  now: number,
): number {
  let evicted = 0
  for (const cluster of storage.clusters.getAll()) {
    if (evicted >= CLUSTERING_CONFIG.MAX_EVICTIONS_PER_RUN) break
    if (!cluster.centroid || newClusterIds.has(cluster.id)) continue
    const sims = memberSimilarities(storage, cluster.id, cluster.centroid)
    if (sims.length < 2) continue

    const best = sims.reduce((a, b) => (b.sim > a.sim ? b : a))
    const dissonant = sims.filter(
      (s) => s.sightingId !== best.sightingId && s.sim < CLUSTERING_CONFIG.EVICTION_THRESHOLD,
    )
    if (dissonant.length === 0) continue

    const signatures = storage.clusters.getSignaturesByClusterId(cluster.id)
    for (const { sightingId } of dissonant) {
      if (evicted >= CLUSTERING_CONFIG.MAX_EVICTIONS_PER_RUN) break
      const newId = uuidv4()
      createUnlabeledCluster(storage, newId, signatures.get(sightingId) ?? null, now)
      storage.clusters.addMembership(newId, sightingId, now)
      storage.clusters.recordMergeDecline(cluster.id, newId, now)
      touched.add(newId)
      evicted++
    }
    recomputeCentroid(storage, cluster.id, now)
    touched.add(cluster.id)
  }
  return evicted
}

function createUnlabeledCluster(
  storage: StorageService,
  id: string,
  centroid: number[] | null,
  now: number,
): void {
  storage.clusters.create({
    id,
    label: '',
    description: '',
    centroid,
    kind: '',
    mechanism: '',
    labelModel: '',
    labeledSize: 0,
    createdAt: now,
    updatedAt: now,
  })
}

/**
 * What the LLM gets to see: clusters needing a (re)label or a kind verdict,
 * every cluster involved in a merge candidate, and the worst clusters below
 * the coherence floor, offered as splittable — the standing exit path from an
 * over-merged cluster (birth-run-only splitting let mega-clusters freeze).
 * New multi-member clusters that made it into the set are splittable too.
 * Singleton clusters are only shown when a merge involves them — they get no
 * label of their own (readers fall back to the member title). The
 * label/classify set is capped per run so a backlog drains gradually; merge
 * candidates and coherence picks ride along uncapped.
 */
function buildReviewInput(
  storage: StorageService,
  touched: Set<string>,
  newClusterIds: Set<string>,
  now: number,
): ReviewInput {
  const all = storage.clusters.getAll()
  const byId = new Map(all.map((c) => [c.id, c]))
  const memberCount = new Map(all.map((c) => [c.id, storage.clusters.getMemberCount(c.id)]))

  const needsReview = (c: Cluster): boolean => {
    const count = memberCount.get(c.id) ?? 0
    if (count < 2) return false
    // Relabel once a cluster doubles since its last labeling (semantic drift);
    // kind === '' means the classify verdict is still missing.
    return c.label === '' || c.kind === '' || count >= 2 * Math.max(1, c.labeledSize)
  }

  const belowFloor: { id: string; coherence: number }[] = []
  for (const c of all) {
    if (!c.centroid || (memberCount.get(c.id) ?? 0) < 2 || newClusterIds.has(c.id)) continue
    const sims = memberSimilarities(storage, c.id, c.centroid)
    if (sims.length === 0) continue
    const coherence = sims.reduce((sum, s) => sum + s.sim, 0) / sims.length
    if (coherence < CLUSTERING_CONFIG.SPLIT_COHERENCE_FLOOR)
      belowFloor.push({ id: c.id, coherence })
  }
  belowFloor.sort((a, b) => a.coherence - b.coherence)
  // Only offer what geometry can actually act on: a below-floor cluster whose
  // members re-group as one is unsplittable — offering it would burn a slot
  // and an incoherent verdict on it would no-op, every run, forever.
  const coherencePicks: string[] = []
  for (const { id } of belowFloor) {
    if (coherencePicks.length >= CLUSTERING_CONFIG.MAX_SPLITTABLE_PER_RUN) break
    const signatures = storage.clusters.getSignaturesByClusterId(id)
    const groups = averageLinkageGroups(
      [...signatures].map(([sightingId, vector]) => ({ sightingId, vector })),
      CLUSTERING_CONFIG.SIMILARITY_THRESHOLD,
    )
    if (groups.length >= 2) coherencePicks.push(id)
  }

  // Merge candidates: touched clusters vs all others, centroid cosine in the
  // "probably the same process, let the LLM decide" band below the automatic
  // attach threshold. Recently declined pairs sit out until the TTL expires.
  const declined = storage.clusters.getActiveMergeDeclines(
    now - CLUSTERING_CONFIG.MERGE_DECLINE_TTL_MS,
  )
  const mergeCandidates: [string, string][] = []
  const inMerge = new Set<string>()
  const seenPairs = new Set<string>()
  for (const id of touched) {
    const a = byId.get(id)
    if (!a?.centroid) continue
    for (const b of all) {
      if (b.id === id || !b.centroid) continue
      const key = mergePairKey(id, b.id)
      if (seenPairs.has(key)) continue
      seenPairs.add(key)
      if (declined.has(key)) continue
      if (dot(a.centroid, b.centroid) >= CLUSTERING_CONFIG.MERGE_CANDIDATE_THRESHOLD) {
        mergeCandidates.push([id, b.id])
        inMerge.add(id)
        inMerge.add(b.id)
      }
    }
  }

  // Cap the label/classify backlog deterministically: biggest clusters first
  // (most user-visible), then oldest, so the same clusters aren't starved.
  const capped = all
    .filter((c) => needsReview(c))
    .sort(
      (a, b) =>
        (memberCount.get(b.id) ?? 0) - (memberCount.get(a.id) ?? 0) || a.createdAt - b.createdAt,
    )
    .slice(0, CLUSTERING_CONFIG.MAX_REVIEW_CLUSTERS_PER_RUN)

  const reviewIds = new Set<string>([...capped.map((c) => c.id), ...inMerge, ...coherencePicks])
  const splittable = new Set<string>(coherencePicks)
  for (const id of reviewIds) {
    if (newClusterIds.has(id) && (memberCount.get(id) ?? 0) >= 2) splittable.add(id)
  }

  const clusters: ReviewCluster[] = [...reviewIds].map((id) =>
    toReviewCluster(storage, byId.get(id)!, splittable.has(id)),
  )

  return { clusters, mergeCandidates }
}

/**
 * Serialize one cluster the way the review LLM sees it — code-computed stats
 * over all members; most-recent member sample, extended when the cluster may
 * be split (still capped: an unbounded mega-cluster would blow the prompt).
 * Also used by the review-input snapshot dumper.
 */
export function toReviewCluster(
  storage: StorageService,
  cluster: Cluster,
  splittable: boolean,
): ReviewCluster {
  const members = storage.clusters.getMembers(cluster.id)
  // Members come back oldest-first; show the most recent sample.
  const sample = members.slice(
    -(splittable ? CLUSTERING_CONFIG.MAX_SPLITTABLE_MEMBERS : CLUSTERING_CONFIG.MAX_SAMPLE_MEMBERS),
  )
  const spanMs =
    members.length > 0 ? members[members.length - 1].startedAt - members[0].startedAt : 0
  return {
    id: cluster.id,
    splittable,
    label: cluster.label,
    stats: {
      times_seen: members.length,
      span_days: Math.floor(spanMs / DAY_MS) + 1,
      median_active_min: median(members.map((m) => m.interactionMin)),
    },
    members: sample.map((s) => ({
      sighting_id: s.id,
      title: s.title,
      description: s.description,
      apps: s.apps,
      interaction_min: s.interactionMin,
      date: new Date(s.startedAt).toISOString().slice(0, 10),
    })),
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const raw = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return Math.round(raw * 10) / 10
}
