/**
 * Message types shared by ml-worker (utilityProcess) and MlWorkerClient.
 * Kept free of heavy imports: the client imports this without pulling
 * transformers.js/onnxruntime into the main process.
 */

export type MlWorkerRequestBody =
  | { type: 'init'; bundledModelPath: string | null; cacheDir: string; maxThreads: number | null }
  | { type: 'embedBatch'; texts: string[] }
  | { type: 'clusterVectors'; vectors: ArrayBuffer; dims: number; threshold: number }

export type MlWorkerRequest = MlWorkerRequestBody & { id: number }

export type MlWorkerResult =
  | { type: 'ready' }
  | { type: 'vectors'; vectors: ArrayBuffer; dims: number }
  | { type: 'groups'; groups: number[][] }

export type MlWorkerResponse =
  | { id: number; ok: true; result: MlWorkerResult }
  | { id: number; ok: false; error: string }

/** Flatten row vectors into one Float32Array buffer so crossing the process
 * boundary is a single copy instead of a per-number structured clone. */
export function packVectors(vectors: readonly (readonly number[])[]): {
  buffer: ArrayBuffer
  dims: number
} {
  const dims = vectors[0]?.length ?? 0
  const flat = new Float32Array(vectors.length * dims)
  vectors.forEach((vector, i) => flat.set(vector, i * dims))
  return { buffer: flat.buffer, dims }
}

export function unpackVectors(buffer: ArrayBuffer, dims: number): number[][] {
  if (dims === 0) return []
  const flat = new Float32Array(buffer)
  const out: number[][] = []
  for (let offset = 0; offset < flat.length; offset += dims) {
    out.push(Array.from(flat.subarray(offset, offset + dims)))
  }
  return out
}
