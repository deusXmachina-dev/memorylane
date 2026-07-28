import { v4 as uuidv4 } from 'uuid'
import type { StorageService } from '@main/storage'
import type { ClusterRecipe } from '@main/storage/cluster-repository'
import { mergePairKey } from '@main/storage/cluster-repository'
import { scrubPII } from '@/shared/sanitize'
import { averageLinkageGroups } from './attach'
import { recomputeCentroid } from './signatures'
import type { ReviewClusterVerdict, ReviewOutput } from './types'
import { CLUSTERING_CONFIG, REVIEW_KINDS } from './types'
import { normalizeSteps } from '../candidate-normalizer'
import type { ProgressCallback } from '../types'

export { mergePairKey }

/**
 * What the LLM was actually shown — anything outside these sets is treated as
 * a hallucination and dropped.
 */
export interface StructureGuards {
  /** Cluster ids sent to the structure call. */
  reviewableIds: Set<string>
  /** Clusters shown with their extended member list — the only ones that may be split. */
  splittableIds: Set<string>
  /** Merge candidate pairs as mergePairKey()s. */
  mergeCandidatePairs: Set<string>
}

/**
 * Collapse the LLM's classification to the one stored bit: the mechanism.
 * The response taxonomy (procedure/monitoring/...) exists so the model isn't
 * pressured to invent mechanisms; only a "procedure" claim may carry one.
 * null = no judgment (keep the stored mechanism): an omitted or off-enum
 * kind, or a "procedure" claim without a concrete mechanism — by the prompt's
 * own rule not a procedure, but not a verdict to overwrite an earlier one
 * with either. On a fresh cluster null still lands as '' (not automatable).
 */
export function sanitizeMechanism(raw: ReviewClusterVerdict): string | null {
  if (!(REVIEW_KINDS as readonly string[]).includes(raw.kind ?? '')) return null
  if (raw.kind !== 'procedure') return ''
  const mechanism = (raw.mechanism ?? '').trim()
  return mechanism === '' ? null : mechanism
}

const MAX_RECIPE_VARIABLES = 10

/** Whitelist the LLM's recipe (shape, count/length caps) and scrub PII — the
 * recipe is copied out to external tools. */
export function sanitizeRecipe(raw: ReviewClusterVerdict): ClusterRecipe {
  return {
    steps: normalizeSteps(raw.steps, { transform: scrubPII }),
    variables: normalizeSteps(raw.variables, { cap: MAX_RECIPE_VARIABLES, transform: scrubPII }),
  }
}

/**
 * Validate the structure call's output against what it was shown and apply it
 * in one transaction. Merges first (survivor = earliest created_at — the
 * stable identity rule, regardless of order in the LLM output), then splits
 * and incoherence verdicts. Candidate pairs the LLM saw and left unmerged are
 * recorded as declines (the cluster_merge_declines table). Labels and recipes
 * are the content round's job — a merge or split clears the recipe, which is
 * exactly what queues the cluster there.
 */
export function applyStructure(
  storage: StorageService,
  review: ReviewOutput,
  guards: StructureGuards,
  now: number,
  progress?: ProgressCallback,
  /** Re-split groups per incoherent cluster, precomputed off-thread by the
   * caller (the transaction below can't await the ml-worker). Absent →
   * in-process linkage. */
  resplitGroups?: ReadonlyMap<string, string[][]>,
): { merged: number; split: number } {
  let merged = 0
  let split = 0

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
      // The survivor's recipe was derived from only its pre-merge members —
      // clearing it queues the cluster for the content round.
      storage.clusters.updateRecipe(survivor.id, { steps: [], variables: [] })
      recomputeCentroid(storage, survivor.id)
    }

    // Candidate pairs the LLM saw and did not propose merging are declines.
    // Pairs it proposed but validation dropped are NOT — it said yes. The
    // prompt requires an explicit "merges" array even when empty; a response
    // without one is degenerate and declines nothing. Pairs touching a
    // just-deleted cluster are skipped so no rows reference dead ids.
    if (Array.isArray(review.merges)) {
      for (const key of guards.mergeCandidatePairs) {
        if (proposedPairs.has(key)) continue
        const [a, b] = key.split('|')
        if (deleted.has(a) || deleted.has(b)) continue
        storage.clusters.recordMergeDecline(a, b, now)
      }
    }

    // --- Splits and incoherence ---
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
        const groups = verdict.split.map((g) =>
          (g.sighting_ids ?? []).filter((id) => {
            if (!memberIds.has(id) || assigned.has(id)) return false
            assigned.add(id)
            return true
          }),
        )
        const nonEmpty = groups.filter((g) => g.length > 0)
        if (nonEmpty.length < 2) {
          progress?.(`[Clustering] Dropped degenerate split of cluster ${verdict.id}`)
          continue
        }
        const largest = nonEmpty.reduce((a, b) => (b.length > a.length ? b : a))
        for (const id of memberIds) {
          if (!assigned.has(id)) largest.push(id)
        }

        applySplit(storage, verdict.id, nonEmpty, now)
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
        if (resplitByGeometry(storage, verdict.id, resplitGroups?.get(verdict.id), now, progress))
          split++
        consumed.add(verdict.id)
      }
    }
  })
  apply()

  return { merged, split }
}

/**
 * Apply content verdicts (label + classification + recipe) to the clusters
 * the content call was shown. Wipe-protections: an omitted or malformed
 * classification keeps the stored mechanism, omitted steps keep the stored
 * recipe — the cluster then simply stays queued for the next content round.
 */
export function applyContent(
  storage: StorageService,
  review: ReviewOutput,
  reviewableIds: Set<string>,
  progress?: ProgressCallback,
): { labeled: number } {
  let labeled = 0

  const apply = storage.getDatabase().transaction(() => {
    for (const verdict of review.clusters ?? []) {
      if (!reviewableIds.has(verdict.id) || !verdict.label) continue
      const existing = storage.clusters.getById(verdict.id)
      if (!existing) continue
      // A label verdict on a singleton would mint a single-run recipe.
      if (storage.clusters.getMemberCount(verdict.id) < 2) {
        progress?.(`[Clustering] Dropped label for single-member cluster ${verdict.id}`)
        continue
      }
      storage.clusters.updateLabel(
        verdict.id,
        verdict.label,
        verdict.description ?? '',
        sanitizeMechanism(verdict),
        storage.clusters.getMemberCount(verdict.id),
      )
      const recipe = sanitizeRecipe(verdict)
      if (recipe.steps.length > 0) {
        storage.clusters.updateRecipe(verdict.id, recipe)
      } else if (existing.steps.length === 0) {
        progress?.(`[Clustering] Label verdict without steps left cluster ${verdict.id} stepless`)
      }
      labeled++
    }
  })
  apply()

  return { labeled }
}

/**
 * The largest group keeps the original cluster id and label — stable identity
 * (and its "seen X times" history) follows the dominant process; the rest
 * move to new unlabeled clusters. Recipes are cleared everywhere: membership
 * changed, so the content round renames and re-classifies all of them.
 */
function applySplit(
  storage: StorageService,
  clusterId: string,
  groups: string[][],
  now: number,
): void {
  const largest = groups.reduce((a, b) => (b.length > a.length ? b : a))
  for (const group of groups) {
    if (group === largest) continue
    const newId = uuidv4()
    storage.clusters.create({
      id: newId,
      label: '',
      description: '',
      centroid: null,
      mechanism: '',
      steps: [],
      variables: [],
      labeledSize: 0,
      createdAt: now,
    })
    for (const sightingId of group) {
      storage.clusters.addMembership(newId, sightingId)
    }
    recomputeCentroid(storage, newId)
  }
  storage.clusters.updateRecipe(clusterId, { steps: [], variables: [] })
  recomputeCentroid(storage, clusterId)
}

/**
 * Deterministic repair for a cluster the LLM marked incoherent: re-group its
 * own member signatures by average-linkage. The LLM's judgment triggers the
 * split, the geometry assigns the members — the LLM saw only a sample, so its
 * member assignment can't be trusted. Groups come out unlabeled and are
 * (re)labeled by the content round. No-op if the geometry finds one group.
 */
function resplitByGeometry(
  storage: StorageService,
  clusterId: string,
  precomputed: string[][] | undefined,
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
  progress?.(
    `[Clustering] Re-split incoherent cluster ${clusterId} into ` +
      `${groups.map((g) => g.length).join('+')} members`,
  )
  applySplit(storage, clusterId, groups, now)
  return true
}
