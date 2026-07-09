import { v4 as uuidv4 } from 'uuid'
import type { StorageService } from '@main/storage'
import type { ClusterVerdict } from '@main/storage/cluster-repository'
import { mergePairKey } from '@main/storage/cluster-repository'
import { CLUSTER_KINDS } from '@/shared/types'
import type { ClusterKind } from '@types'
import { averageLinkageGroups } from './attach'
import { recomputeCentroid } from './signatures'
import type { ReviewClusterVerdict, ReviewOutput } from './types'
import { CLUSTERING_CONFIG } from './types'
import type { ProgressCallback } from '../types'

export { mergePairKey }

/**
 * What the LLM was actually shown — anything outside these sets is treated as
 * a hallucination and dropped.
 */
export interface ReviewGuards {
  /** Cluster ids sent for review (labelable / mergeable). */
  reviewableIds: Set<string>
  /** Clusters shown with their extended member list — the only ones that may be split. */
  splittableIds: Set<string>
  /** Merge candidate pairs as mergePairKey()s. */
  mergeCandidatePairs: Set<string>
}

/**
 * Whitelist the LLM's classification into a storable verdict. Fail closed:
 * anything off-enum — including a "procedure" without a concrete mechanism —
 * coerces to kind '' (the unclassified sentinel, never persisted over an
 * earlier classification). Non-procedure kinds never carry a mechanism.
 */
export function sanitizeVerdict(raw: ReviewClusterVerdict): ClusterVerdict {
  const kind = (CLUSTER_KINDS as readonly string[]).includes(raw.kind ?? '')
    ? (raw.kind as ClusterKind)
    : ''
  const mechanism = kind === 'procedure' ? (raw.mechanism ?? '').trim() : ''
  if (kind === 'procedure' && mechanism === '') return { kind: '', mechanism: '' }
  return { kind, mechanism }
}

/**
 * Validate the LLM's review against what it was shown and apply it in one
 * transaction. Merges first (survivor = earliest created_at — the stable
 * identity rule, regardless of order in the LLM output), then splits and
 * incoherence verdicts, then labels for everything untouched by a merge/split.
 * Candidate pairs the LLM saw and left unmerged are recorded as declines
 * (see cluster_merge_declines in cluster-schema.ts).
 */
export function validateAndApply(
  storage: StorageService,
  review: ReviewOutput,
  guards: ReviewGuards,
  model: string,
  now: number,
  progress?: ProgressCallback,
  /** Re-split groups per incoherent cluster, precomputed off-thread by the
   * caller (the transaction below can't await the ml-worker). Absent →
   * in-process linkage. */
  resplitGroups?: ReadonlyMap<string, string[][]>,
): { merged: number; split: number; labeled: number } {
  let merged = 0
  let split = 0
  let labeled = 0

  const apply = storage.getDatabase().transaction(() => {
    const consumed = new Set<string>()
    const deleted = new Set<string>()

    // --- Merges ---
    const proposedPairs = new Set<string>()
    for (const proposal of review.merges ?? []) {
      const ids = [...new Set(proposal.merge ?? [])]
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) proposedPairs.add(mergePairKey(ids[i], ids[j]))
      }
      if (ids.length < 2) continue
      if (!ids.every((id) => guards.reviewableIds.has(id) && !consumed.has(id))) {
        progress?.('[Clustering] Dropped merge with unknown or already-merged cluster id')
        continue
      }
      // Every pair in the merge must have been proposed as a candidate. A
      // chain (A~B, B~C but not A~C) is exactly how unrelated clusters ratchet
      // into one — the LLM never judged A against C.
      const allPairsCandidates = ids.every((a, i) =>
        ids.slice(i + 1).every((b) => guards.mergeCandidatePairs.has(mergePairKey(a, b))),
      )
      if (!allPairsCandidates) {
        progress?.('[Clustering] Dropped merge with a pair outside the candidate list')
        continue
      }

      const clusters = ids
        .map((id) => storage.clusters.getById(id))
        .filter((c): c is NonNullable<typeof c> => c !== null)
      if (clusters.length !== ids.length) continue
      const survivor = clusters.reduce((a, b) => (b.createdAt < a.createdAt ? b : a))

      for (const cluster of clusters) {
        if (cluster.id === survivor.id) continue
        storage.clusters.moveMemberships(cluster.id, survivor.id)
        storage.clusters.delete(cluster.id)
        consumed.add(cluster.id)
        deleted.add(cluster.id)
        merged++
      }
      consumed.add(survivor.id)
      storage.clusters.updateLabel(
        survivor.id,
        proposal.label ?? '',
        proposal.description ?? '',
        model,
        storage.clusters.getMemberCount(survivor.id),
        now,
      )
      // The survivor's verdict was judged against only its pre-merge members —
      // clear it so the merged cluster is re-classified on the next review.
      storage.clusters.updateVerdict(survivor.id, { kind: '', mechanism: '' }, now)
      recomputeCentroid(storage, survivor.id, now)
      labeled++
    }

    // Candidate pairs the LLM saw and did not propose merging are declines.
    // Pairs it proposed but validation dropped are NOT — it said yes. A
    // degenerate response (parseable but empty) declines nothing: absence of
    // any verdict is not a judgment. Pairs touching a just-deleted cluster
    // are skipped so no rows reference dead ids.
    const answered = (review.clusters?.length ?? 0) > 0 || (review.merges?.length ?? 0) > 0
    if (answered) {
      for (const key of guards.mergeCandidatePairs) {
        if (proposedPairs.has(key)) continue
        const [a, b] = key.split('|')
        if (deleted.has(a) || deleted.has(b)) continue
        storage.clusters.recordMergeDecline(a, b, now)
      }
    }

    // --- Splits, incoherence, labels ---
    for (const verdict of review.clusters ?? []) {
      if (!guards.reviewableIds.has(verdict.id) || consumed.has(verdict.id)) continue

      if (verdict.split && verdict.split.length >= 2) {
        if (!guards.splittableIds.has(verdict.id)) {
          progress?.(`[Clustering] Dropped split of non-splittable cluster ${verdict.id}`)
          continue
        }
        const members = storage.clusters.getMembers(verdict.id)
        const memberIds = new Set(members.map((m) => m.id))

        // Each member goes to exactly one group (first claim wins); ids the
        // LLM invented are dropped; unassigned members go to the largest group.
        const assigned = new Set<string>()
        const groups = verdict.split.map((g) => ({
          label: g.label ?? '',
          description: g.description ?? '',
          sightingIds: (g.sighting_ids ?? []).filter((id) => {
            if (!memberIds.has(id) || assigned.has(id)) return false
            assigned.add(id)
            return true
          }),
        }))
        const nonEmpty = groups.filter((g) => g.sightingIds.length > 0)
        if (nonEmpty.length < 2) {
          progress?.(`[Clustering] Dropped degenerate split of cluster ${verdict.id}`)
          continue
        }
        const largest = nonEmpty.reduce((a, b) =>
          b.sightingIds.length > a.sightingIds.length ? b : a,
        )
        for (const id of memberIds) {
          if (!assigned.has(id)) largest.sightingIds.push(id)
        }

        applySplit(storage, verdict.id, nonEmpty, model, now)
        consumed.add(verdict.id)
        split++
        continue
      }

      if (verdict.incoherent) {
        // Only clusters shown in full may be dismantled — an incoherent call
        // made from a 15-member sample is not trusted.
        if (!guards.splittableIds.has(verdict.id)) {
          progress?.(`[Clustering] Dropped incoherent verdict on non-splittable ${verdict.id}`)
          continue
        }
        if (
          resplitByGeometry(
            storage,
            verdict.id,
            resplitGroups?.get(verdict.id),
            model,
            now,
            progress,
          )
        )
          split++
        consumed.add(verdict.id)
        continue
      }

      if (verdict.label) {
        if (!storage.clusters.getById(verdict.id)) continue
        storage.clusters.updateLabel(
          verdict.id,
          verdict.label,
          verdict.description ?? '',
          model,
          storage.clusters.getMemberCount(verdict.id),
          now,
        )
        // Only persist a valid verdict — an omitted or unsanitizable kind on a
        // relabel must not wipe an earlier classification. An unclassified
        // cluster keeps kind '' and is re-reviewed next run either way.
        if (verdict.kind !== undefined) {
          const sanitized = sanitizeVerdict(verdict)
          if (sanitized.kind !== '') {
            storage.clusters.updateVerdict(verdict.id, sanitized, now)
          }
        }
        labeled++
      }
    }
  })
  apply()

  return { merged, split, labeled }
}

interface SplitGroup {
  label: string
  description: string
  sightingIds: string[]
}

/**
 * The largest group keeps the original cluster id — stable identity (and its
 * "seen X times" history) follows the dominant process; the rest move to new
 * clusters. Kind is cleared everywhere: membership changed, so the old
 * classification no longer applies. Unlabeled groups get empty label
 * provenance — the model never labeled them.
 */
function applySplit(
  storage: StorageService,
  clusterId: string,
  groups: SplitGroup[],
  model: string,
  now: number,
): void {
  const largest = groups.reduce((a, b) => (b.sightingIds.length > a.sightingIds.length ? b : a))
  for (const group of groups) {
    if (group === largest) continue
    const newId = uuidv4()
    storage.clusters.create({
      id: newId,
      label: group.label,
      description: group.description,
      centroid: null,
      // Split groups are new processes — classified on the next review.
      kind: '',
      mechanism: '',
      labelModel: group.label ? model : '',
      labeledSize: group.label ? group.sightingIds.length : 0,
      createdAt: now,
      updatedAt: now,
    })
    for (const sightingId of group.sightingIds) {
      storage.clusters.addMembership(newId, sightingId, now)
    }
    recomputeCentroid(storage, newId, now)
  }
  storage.clusters.updateLabel(
    clusterId,
    largest.label,
    largest.description,
    largest.label ? model : '',
    largest.label ? largest.sightingIds.length : 0,
    now,
  )
  storage.clusters.updateVerdict(clusterId, { kind: '', mechanism: '' }, now)
  recomputeCentroid(storage, clusterId, now)
}

/**
 * Deterministic repair for a cluster the LLM marked incoherent: re-group its
 * own member signatures by average-linkage. The LLM's judgment triggers the
 * split, the geometry assigns the members — the LLM saw only a sample, so its
 * member assignment can't be trusted. Groups come out unlabeled and are
 * (re)labeled on the next review. No-op if the geometry finds one group.
 */
function resplitByGeometry(
  storage: StorageService,
  clusterId: string,
  precomputed: string[][] | undefined,
  model: string,
  now: number,
  progress?: ProgressCallback,
): boolean {
  const groups =
    precomputed ??
    averageLinkageGroups(
      [...storage.clusters.getSignaturesByClusterId(clusterId)].map(([sightingId, vector]) => ({
        sightingId,
        vector,
      })),
      CLUSTERING_CONFIG.SIMILARITY_THRESHOLD,
    ).sort((a, b) => b.length - a.length)
  if (groups.length < 2) {
    progress?.(`[Clustering] Incoherent verdict on ${clusterId} but geometry finds one group`)
    return false
  }
  // Members with no signature can't be placed — they stay with the survivor.
  const splitGroups: SplitGroup[] = groups.map((ids) => ({
    label: '',
    description: '',
    sightingIds: ids,
  }))
  progress?.(
    `[Clustering] Re-split incoherent cluster ${clusterId} into ` +
      `${groups.map((g) => g.length).join('+')} members`,
  )
  applySplit(storage, clusterId, splitGroups, model, now)
  return true
}
