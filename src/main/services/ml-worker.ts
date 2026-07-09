import { EmbeddingService, configureModelEnv } from '@main/processor/embedding'
import { averageLinkageGroupIndices } from '@main/services/task-miner/clustering/attach'
import {
  packVectors,
  unpackVectors,
  type MlWorkerRequest,
  type MlWorkerResponse,
} from './ml-worker-protocol'

/**
 * Long-lived utilityProcess hosting the embedding model and the unbounded-n
 * linkage math, so onnx forward passes and O(n³) agglomeration never run on
 * the main thread. One request → one response, correlated by id.
 */

const embedder = new EmbeddingService()

/** Exported for unit tests; the parentPort wiring below is the runtime path. */
export async function handleMlWorkerRequest(
  request: MlWorkerRequest,
  service: EmbeddingService = embedder,
): Promise<MlWorkerResponse> {
  try {
    switch (request.type) {
      case 'init': {
        configureModelEnv({
          bundledModelPath: request.bundledModelPath,
          cacheDir: request.cacheDir,
          maxThreads: request.maxThreads,
        })
        await service.init()
        return { id: request.id, ok: true, result: { type: 'ready' } }
      }
      case 'embedBatch': {
        const { buffer, dims } = packVectors(await service.embedBatch(request.texts))
        return { id: request.id, ok: true, result: { type: 'vectors', vectors: buffer, dims } }
      }
      case 'clusterVectors': {
        const vectors = unpackVectors(request.vectors, request.dims)
        const groups = averageLinkageGroupIndices(vectors, request.threshold)
        return { id: request.id, ok: true, result: { type: 'groups', groups } }
      }
    }
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// `process.parentPort` only exists when this file runs as a forked
// utilityProcess; guarding it keeps the module import-safe for unit tests.
interface ParentPortLike {
  on(event: 'message', listener: (e: { data: MlWorkerRequest }) => void): void
  postMessage(message: MlWorkerResponse): void
}
const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort
if (parentPort) {
  parentPort.on('message', ({ data }) => {
    void handleMlWorkerRequest(data).then((response) => parentPort.postMessage(response))
  })
}
