import { v4 as uuidv4 } from 'uuid'
import type { StorageService } from '@main/storage'
import { UnionFind } from './union-find'
import { meanPool, normalize } from './vector-math'
import { recomputeCentroid } from './signatures'
import type { ReviewOutput } from './types'
import type { ProgressCallback } from '../types'

/**
 * What the LLM was actually shown — anything outside these sets is treated as
 * a hallucination and dropped.
 */
export interface ReviewGuards {
  /** Cluster ids sent for review (labelable / mergeable). */
  reviewableIds: Set<string>
  /** Clusters created this run — the only ones that may be split. */
  newClusterIds: Set<string>
  /** Merge candidate pairs, as canonical `${a}|${b}` keys with a < b. */
  mergeCandidatePairs: Set<string>
}

export function mergePairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * Validate the LLM's review against what it was shown and apply it in one
 * transaction. Merges first (survivor = earliest created_at — the stable
 * identity rule, regardless of order in the LLM output), then splits of
 * this-run clusters, then labels for everything untouched by a merge/split.
 */
export function validateAndApply(
  storage: StorageService,
  review: ReviewOutput,
  guards: ReviewGuards,
  model: string,
  now: number,
  progress?: ProgressCallback,
): { merged: number; split: number; labeled: number } {
  let merged = 0
  let split = 0
  let labeled = 0

  const apply = storage.getDatabase().transaction(() => {
    const consumed = new Set<string>()

    // --- Merges ---
    for (const proposal of review.merges ?? []) {
      const ids = [...new Set(proposal.merge ?? [])]
      if (ids.length < 2) continue
      if (!ids.every((id) => guards.reviewableIds.has(id) && !consumed.has(id))) {
        progress?.('[Clustering] Dropped merge with unknown or already-merged cluster id')
        continue
      }
      // A multi-cluster merge is only trusted if it's connected through the
      // candidate pairs we proposed (chains allowed, arbitrary sets not).
      const uf = new UnionFind(ids.length)
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          if (guards.mergeCandidatePairs.has(mergePairKey(ids[i], ids[j]))) uf.union(i, j)
        }
      }
      if (uf.components().length > 1) {
        progress?.('[Clustering] Dropped merge not connected through candidate pairs')
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
      recomputeCentroid(storage, survivor.id, now)
      labeled++
    }

    // --- Splits and labels ---
    for (const verdict of review.clusters ?? []) {
      if (!guards.reviewableIds.has(verdict.id) || consumed.has(verdict.id)) continue

      if (verdict.split && verdict.split.length >= 2) {
        if (!guards.newClusterIds.has(verdict.id)) {
          progress?.(`[Clustering] Dropped split of pre-existing cluster ${verdict.id}`)
          continue
        }
        const members = storage.clusters.getMembers(verdict.id)
        const memberIds = new Set(members.map((m) => m.id))
        const signatures = storage.clusters.getSignaturesByClusterId(verdict.id)

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

        storage.clusters.delete(verdict.id)
        for (const group of nonEmpty) {
          const clusterId = uuidv4()
          const groupVectors = group.sightingIds
            .map((id) => signatures.get(id))
            .filter((v): v is number[] => Boolean(v))
          storage.clusters.create({
            id: clusterId,
            label: group.label,
            description: group.description,
            centroid: normalize(meanPool(groupVectors) ?? []),
            labelModel: model,
            labeledSize: group.sightingIds.length,
            createdAt: now,
            updatedAt: now,
          })
          for (const sightingId of group.sightingIds) {
            storage.clusters.addMembership(clusterId, sightingId, now)
          }
        }
        consumed.add(verdict.id)
        split++
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
        labeled++
      }
    }
  })
  apply()

  return { merged, split, labeled }
}
