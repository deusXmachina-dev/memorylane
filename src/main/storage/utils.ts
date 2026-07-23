/** sqlite-vec hard limit for the k parameter in knn queries. */
export const SQLITE_VEC_KNN_MAX = 4096

/**
 * Sanitizes a user query string for FTS5 MATCH.
 * Quotes each token to prevent FTS5 syntax errors from special characters.
 */
export function sanitizeFtsQuery(query: string): string {
  const tokens = query.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return '""'
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' ')
}

/** Parse a JSON string-array column, tolerating null/legacy/corrupt values. */
export function parseJsonStringArray(value: unknown): string[] {
  if (typeof value !== 'string' || value.length === 0) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

export function vectorToBlob(vector: number[]): Buffer {
  const float32 = new Float32Array(vector)
  return Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength)
}

export function blobToVector(blob: Buffer): number[] {
  const float32 = new Float32Array(
    blob.buffer,
    blob.byteOffset,
    blob.byteLength / Float32Array.BYTES_PER_ELEMENT,
  )
  return Array.from(float32)
}
