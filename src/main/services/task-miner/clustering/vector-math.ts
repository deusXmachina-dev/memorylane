/** Dot product. On unit-normalized vectors this equals cosine similarity. */
export function dot(a: readonly number[], b: readonly number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

/** Element-wise mean of same-length vectors. Returns null for empty input. */
export function meanPool(vectors: readonly (readonly number[])[]): number[] | null {
  if (vectors.length === 0) return null
  const dims = vectors[0].length
  const mean = new Array<number>(dims).fill(0)
  for (const vec of vectors) {
    for (let i = 0; i < dims; i++) mean[i] += vec[i]
  }
  for (let i = 0; i < dims; i++) mean[i] /= vectors.length
  return mean
}

/** Unit-normalize. Returns null for the zero vector (no direction). */
export function normalize(vector: readonly number[]): number[] | null {
  const magnitude = Math.sqrt(dot(vector, vector))
  if (magnitude === 0) return null
  return vector.map((v) => v / magnitude)
}
