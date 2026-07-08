import { agnes } from 'ml-hclust'
import { cosineSimilarity } from './vector-math'

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
      const sim = cosineSimilarity(sig.vector, centroid)
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
 * Group signatures by average-linkage agglomerative clustering (AGNES), cut
 * where the mean pairwise cosine within a group would drop below the
 * threshold. Unlike single-linkage, a group only forms when its members are
 * similar ON AVERAGE — one borderline edge cannot chain unrelated topics into
 * a mega-cluster. Singletons come out as one-member groups — they become
 * clusters too, so "seen X times" can grow from 1.
 */
export function averageLinkageGroups(
  items: readonly SightingSignature[],
  threshold: number,
): string[][] {
  return averageLinkageGroupIndices(
    items.map((i) => i.vector),
    threshold,
  ).map((indices) => indices.map((i) => items[i].sightingId))
}

/** Index-level variant of averageLinkageGroups — also runs inside the
 * ml-worker, where only raw vectors cross the process boundary. */
export function averageLinkageGroupIndices(
  vectors: readonly (readonly number[])[],
  threshold: number,
): number[][] {
  if (vectors.length <= 1) return vectors.map((_, i) => [i])
  const tree = agnes(
    vectors.map((v) => v as number[]),
    { method: 'average', distanceFunction: (a, b) => 1 - cosineSimilarity(a, b) },
  )
  // cut() keeps subtrees whose height (cosine distance) is <= the cutoff, so
  // similarity >= threshold merges — same inclusive rule as before. Groups
  // come back in dendrogram order; re-sort by input position so the result is
  // deterministic for the same input regardless of tree shape.
  return tree
    .cut(1 - threshold)
    .map((group) => group.indices().sort((a, b) => a - b))
    .sort((a, b) => a[0] - b[0])
}
