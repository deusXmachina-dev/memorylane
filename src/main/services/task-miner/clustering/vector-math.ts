import { similarity } from 'ml-distance'
import { Matrix } from 'ml-matrix'

/**
 * Cosine similarity. All clustering vectors are unit-normalized, so this
 * equals the dot product and the CLUSTERING_CONFIG thresholds read as raw
 * cosine values.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  return similarity.cosine(a as number[], b as number[])
}

/** Element-wise mean of same-length vectors. Returns null for empty input. */
export function meanPool(vectors: readonly (readonly number[])[]): number[] | null {
  if (vectors.length === 0) return null
  return new Matrix(vectors as number[][]).mean('column')
}

/** Unit-normalize. Returns null for the zero vector (no direction). */
export function normalize(vector: readonly number[]): number[] | null {
  const magnitude = Math.hypot(...vector)
  if (magnitude === 0) return null
  return vector.map((v) => v / magnitude)
}
