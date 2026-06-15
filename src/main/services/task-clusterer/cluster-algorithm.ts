/**
 * Deterministic, LLM-free clustering of task sightings into process candidates.
 *
 * Two sightings are linked (single-linkage) when their title+description
 * embeddings are close AND their app sets overlap. Connected components over
 * those links become clusters. Given the same input (in the same order) the
 * output is identical — this whole module is pure and unit-tested.
 */

export interface ClusterInput {
  id: string
  apps: string[]
  startedAt: number
  interactionMin: number
  vector: number[]
}

export interface ClusterGroup {
  /** Member ids, sorted ascending for determinism. */
  memberIds: string[]
  /** The member with the highest summed similarity to its peers. */
  medoidId: string
}

export interface ClusterThresholds {
  cosThreshold: number
  appThreshold: number
  minClusterSize: number
}

/** Cosine similarity. Embeddings are L2-normalized, but we normalize defensively. */
export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** Jaccard overlap of two app sets (case-insensitive). */
export function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a.map((x) => x.toLowerCase()))
  const sb = new Set(b.map((x) => x.toLowerCase()))
  if (sa.size === 0 && sb.size === 0) return 0
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  const union = sa.size + sb.size - inter
  return union === 0 ? 0 : inter / union
}

/** Union-find with path compression and union-by-smaller-index for determinism. */
class UnionFind {
  private parent: number[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]]
      i = this.parent[i]
    }
    return i
  }
  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    // Attach the larger root to the smaller so roots stay deterministic.
    if (ra < rb) this.parent[rb] = ra
    else this.parent[ra] = rb
  }
}

/**
 * Cluster the inputs. Inputs should be supplied in a stable order (e.g. sorted
 * by id) so the result is deterministic. Only clusters with at least
 * `minClusterSize` members are returned; singletons are dropped as noise.
 */
export function clusterSightings(
  inputs: ClusterInput[],
  thresholds: ClusterThresholds,
): ClusterGroup[] {
  const n = inputs.length
  const uf = new UnionFind(n)

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (
        cosine(inputs[i].vector, inputs[j].vector) > thresholds.cosThreshold &&
        jaccard(inputs[i].apps, inputs[j].apps) > thresholds.appThreshold
      ) {
        uf.union(i, j)
      }
    }
  }

  // Group member indexes by root.
  const groups = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const root = uf.find(i)
    const arr = groups.get(root)
    if (arr) arr.push(i)
    else groups.set(root, [i])
  }

  const result: ClusterGroup[] = []
  for (const indexes of groups.values()) {
    if (indexes.length < thresholds.minClusterSize) continue
    const memberIds = indexes.map((i) => inputs[i].id).sort()
    result.push({ memberIds, medoidId: pickMedoid(inputs, indexes) })
  }

  // Stable output order: by descending size, then by first member id.
  result.sort((a, b) => {
    if (b.memberIds.length !== a.memberIds.length) return b.memberIds.length - a.memberIds.length
    return a.memberIds[0] < b.memberIds[0] ? -1 : 1
  })
  return result
}

/** Member with the highest summed cosine similarity to its peers (ties → lowest id). */
function pickMedoid(inputs: ClusterInput[], indexes: number[]): string {
  let bestId = inputs[indexes[0]].id
  let bestScore = -Infinity
  for (const i of indexes) {
    let sum = 0
    for (const j of indexes) {
      if (i === j) continue
      sum += cosine(inputs[i].vector, inputs[j].vector)
    }
    const id = inputs[i].id
    if (sum > bestScore || (sum === bestScore && id < bestId)) {
      bestScore = sum
      bestId = id
    }
  }
  return bestId
}
