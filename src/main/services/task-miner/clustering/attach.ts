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
 * clusters too, so "seen X times" can grow from 1. Degenerate vectors (NaN or
 * all-zero) yield similarities that never win a merge, so they fall out as
 * singletons.
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
 * ml-worker, where only raw vectors cross the process boundary. Every input
 * index comes back in exactly one group (resplitByGeometry reassigns cluster
 * membership from this result); groups and members are in input order. */
export function averageLinkageGroupIndices(
  vectors: readonly (readonly number[])[],
  threshold: number,
): number[][] {
  const n = vectors.length
  // Similarity matrix, updated with the Lance-Williams rule on merge:
  // sim(A∪B, C) = (|A|·sim(A,C) + |B|·sim(B,C)) / (|A|+|B|) — exactly the mean
  // pairwise cosine between the merged group and C.
  const sim = Array.from({ length: n }, () => new Float64Array(n))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = dot(vectors[i], vectors[j])
      sim[i][j] = d
      sim[j][i] = d
    }
  }

  const size = new Array<number>(n).fill(1)
  const members = Array.from({ length: n }, (_, i) => [i])
  const active = new Set<number>(Array.from({ length: n }, (_, i) => i))
  const finished: number[] = []

  // Nearest-neighbor chain (Murtagh): follow best partners until two groups
  // are mutually nearest, merge those, keep the chain prefix — average
  // linkage is reducible, so the prefix stays a valid chain and the final
  // partition equals global-best-first agglomeration, in O(n²) not O(n³).
  // Link similarities are non-decreasing along the chain, so when the tip's
  // best partner is below the threshold the whole chain can never merge
  // again and retires. Preferring the predecessor on ties makes revisiting
  // a chain element impossible (a cycle would need sim(a,c) > sim(a,c)).
  const chain: number[] = []
  while (active.size > 1) {
    if (chain.length === 0) chain.push(active.values().next().value as number)
    const tip = chain[chain.length - 1]
    const prev = chain.length > 1 ? chain[chain.length - 2] : -1

    let best = -Infinity
    let next = -1
    for (const b of active) {
      if (b !== tip && sim[tip][b] > best) {
        best = sim[tip][b]
        next = b
      }
    }
    if (best < threshold) {
      // NaN similarities never beat -Infinity, so degenerate vectors land here.
      for (const idx of chain) {
        active.delete(idx)
        finished.push(idx)
      }
      chain.length = 0
      continue
    }
    if (prev !== -1 && sim[tip][prev] >= best) next = prev
    if (next !== prev) {
      chain.push(next)
      continue
    }

    // tip and prev are mutually nearest: merge into the smaller index so a
    // group's root is always its minimum member.
    const [root, gone] = tip < prev ? [tip, prev] : [prev, tip]
    for (const c of active) {
      if (c === root || c === gone) continue
      const merged =
        (size[root] * sim[root][c] + size[gone] * sim[gone][c]) / (size[root] + size[gone])
      sim[root][c] = merged
      sim[c][root] = merged
    }
    members[root].push(...members[gone])
    size[root] += size[gone]
    active.delete(gone)
    chain.length -= 2
  }

  const roots = [...active, ...finished].sort((a, b) => a - b)
  return roots.map((r) => members[r].sort((x, y) => x - y))
}
