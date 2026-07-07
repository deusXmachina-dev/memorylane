import { dot } from './vector-math'

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
 * Group signatures by greedy average-linkage agglomeration: repeatedly merge
 * the two groups whose mean pairwise cosine is highest, until no pair clears
 * the threshold. Unlike single-linkage, a group only forms when its members
 * are similar ON AVERAGE — one borderline edge cannot chain unrelated topics
 * into a mega-cluster. Singletons come out as one-member groups — they become
 * clusters too, so "seen X times" can grow from 1.
 */
export function averageLinkageGroups(
  items: readonly SightingSignature[],
  threshold: number,
): string[][] {
  const n = items.length
  // Similarity matrix, updated with the Lance-Williams rule on merge:
  // sim(A∪B, C) = (|A|·sim(A,C) + |B|·sim(B,C)) / (|A|+|B|) — exactly the mean
  // pairwise cosine between the merged group and C.
  const sim = Array.from({ length: n }, () => new Float64Array(n))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = dot(items[i].vector, items[j].vector)
      sim[i][j] = d
      sim[j][i] = d
    }
  }

  const size = new Array<number>(n).fill(1)
  const members = Array.from({ length: n }, (_, i) => [i])
  const active = new Set<number>(Array.from({ length: n }, (_, i) => i))

  for (;;) {
    let best = -Infinity
    let bestA = -1
    let bestB = -1
    for (const a of active) {
      for (const b of active) {
        if (b <= a) continue
        if (sim[a][b] > best) {
          best = sim[a][b]
          bestA = a
          bestB = b
        }
      }
    }
    if (best < threshold) break

    for (const c of active) {
      if (c === bestA || c === bestB) continue
      const merged =
        (size[bestA] * sim[bestA][c] + size[bestB] * sim[bestB][c]) / (size[bestA] + size[bestB])
      sim[bestA][c] = merged
      sim[c][bestA] = merged
    }
    members[bestA].push(...members[bestB])
    size[bestA] += size[bestB]
    active.delete(bestB)
  }

  return [...active].map((a) => members[a].map((i) => items[i].sightingId))
}
