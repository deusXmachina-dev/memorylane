import { dot } from './vector-math'
import { UnionFind } from './union-find'

export interface SightingSignature {
  sightingId: string
  /** Unit-normalized. */
  vector: number[]
}

export interface ClusterCentroid {
  clusterId: string
  /** Unit-normalized. */
  centroid: number[]
}

/**
 * Attach each new signature to its best-matching existing cluster if the
 * cosine similarity clears the threshold. Centroids are frozen for the whole
 * pass so the result is order-independent.
 */
export function attachToCentroids(
  signatures: readonly SightingSignature[],
  centroids: readonly ClusterCentroid[],
  threshold: number,
): {
  attached: { sightingId: string; clusterId: string }[]
  leftovers: SightingSignature[]
} {
  const attached: { sightingId: string; clusterId: string }[] = []
  const leftovers: SightingSignature[] = []

  for (const sig of signatures) {
    let bestClusterId: string | null = null
    let bestSim = -Infinity
    for (const { clusterId, centroid } of centroids) {
      const sim = dot(sig.vector, centroid)
      if (sim > bestSim) {
        bestSim = sim
        bestClusterId = clusterId
      }
    }
    if (bestClusterId !== null && bestSim >= threshold) {
      attached.push({ sightingId: sig.sightingId, clusterId: bestClusterId })
    } else {
      leftovers.push(sig)
    }
  }

  return { attached, leftovers }
}

/**
 * First-cut grouping of the signatures that didn't attach anywhere: pairwise
 * cosine, edge at >= threshold, union-find connected components
 * (single-linkage). Singletons come out as one-member groups — they become
 * clusters too, so "seen X times" can grow from 1.
 */
export function clusterLeftovers(
  leftovers: readonly SightingSignature[],
  threshold: number,
): string[][] {
  const uf = new UnionFind(leftovers.length)
  for (let i = 0; i < leftovers.length; i++) {
    for (let j = i + 1; j < leftovers.length; j++) {
      if (dot(leftovers[i].vector, leftovers[j].vector) >= threshold) uf.union(i, j)
    }
  }
  return uf.components().map((members) => members.map((i) => leftovers[i].sightingId))
}
