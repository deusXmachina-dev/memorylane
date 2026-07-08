import { app, utilityProcess } from 'electron'
import type { UtilityProcess } from 'electron'
import * as path from 'path'
import log from '@main/utils/logger'
import { getBundledModelPath, getModelCacheDir } from '@main/utils/paths'
import type { ActivityEmbeddingService } from '@main/activity/activity-transformer-types'
import {
  packVectors,
  unpackVectors,
  type MlWorkerRequest,
  type MlWorkerRequestBody,
  type MlWorkerResponse,
  type MlWorkerResult,
} from './ml-worker-protocol'

// Built alongside index.js (see electron.vite.config.ts rollup input).
function workerScriptPath(): string {
  return path.join(app.getAppPath(), 'out', 'main', 'ml-worker.js')
}

// First run may download the ~100 MB model, so init gets a generous bound.
const INIT_TIMEOUT_MS = 5 * 60 * 1000
const EMBED_TIMEOUT_MS = 60 * 1000
const CLUSTER_TIMEOUT_MS = 2 * 60 * 1000
const RESPAWN_WINDOW_MS = 60 * 1000
const MAX_SPAWNS_PER_WINDOW = 3

interface PendingRequest {
  resolve(result: MlWorkerResult): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Main-process handle to the long-lived ml-worker utilityProcess. Lazily
 * spawns the worker (and respawns it after a crash or timeout kill, capped so
 * a persistently broken worker fails fast instead of respawn-looping).
 */
export class MlWorkerClient implements ActivityEmbeddingService {
  private child: UtilityProcess | null = null
  private ready: Promise<void> | null = null
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private spawnTimes: number[] = []

  /** Spawns the worker and loads the model. Awaited at startup so a broken
   * model cache aborts like the old in-process init did. */
  async init(): Promise<void> {
    await this.ensureReady()
  }

  async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text])
    return vector
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    await this.ensureReady()
    const result = await this.request({ type: 'embedBatch', texts }, EMBED_TIMEOUT_MS)
    if (result.type !== 'vectors') throw new Error(`ml-worker: unexpected ${result.type} response`)
    return unpackVectors(result.vectors, result.dims)
  }

  /** Average-linkage grouping in the worker; returns groups of input indices. */
  async clusterVectors(
    vectors: readonly (readonly number[])[],
    threshold: number,
  ): Promise<number[][]> {
    if (vectors.length <= 1) return vectors.map((_, i) => [i])
    await this.ensureReady()
    const packed = packVectors(vectors)
    const result = await this.request(
      { type: 'clusterVectors', vectors: packed.buffer, dims: packed.dims, threshold },
      CLUSTER_TIMEOUT_MS,
    )
    if (result.type !== 'groups') throw new Error(`ml-worker: unexpected ${result.type} response`)
    return result.groups
  }

  dispose(): void {
    this.failPending(new Error('ml-worker disposed'))
    this.child?.kill()
    this.child = null
    this.ready = null
  }

  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.spawnAndInit().catch((error) => {
        this.ready = null
        throw error
      })
    }
    return this.ready
  }

  private async spawnAndInit(): Promise<void> {
    const now = Date.now()
    this.spawnTimes = this.spawnTimes.filter((t) => now - t < RESPAWN_WINDOW_MS)
    if (this.spawnTimes.length >= MAX_SPAWNS_PER_WINDOW) {
      throw new Error('ml-worker respawning too fast; retry later')
    }
    this.spawnTimes.push(now)

    const child = utilityProcess.fork(workerScriptPath(), [], { serviceName: 'ml-worker' })
    this.child = child

    child.on('message', (message: MlWorkerResponse) => this.settle(message))
    child.on('exit', (code) => {
      if (this.child === child) {
        this.child = null
        this.ready = null
      }
      this.failPending(new Error(`ml-worker exited (code ${code})`))
    })

    await new Promise<void>((resolve, reject) => {
      let settled = false
      child.once('spawn', () => {
        if (settled) return
        settled = true
        resolve()
      })
      child.once('exit', (code) => {
        if (settled) return
        settled = true
        reject(new Error(`ml-worker exited before spawn (code ${code})`))
      })
    })

    // The worker has no `app`; hand it paths this process resolved.
    const result = await this.request(
      { type: 'init', bundledModelPath: getBundledModelPath(), cacheDir: getModelCacheDir() },
      INIT_TIMEOUT_MS,
    )
    if (result.type !== 'ready') throw new Error('ml-worker: bad init response')
    log.info('[MlWorker] Worker ready (embedding model loaded)')
  }

  private request(body: MlWorkerRequestBody, timeoutMs: number): Promise<MlWorkerResult> {
    const child = this.child
    if (!child) return Promise.reject(new Error('ml-worker not running'))
    const id = this.nextId++
    return new Promise<MlWorkerResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`ml-worker ${body.type} timed out after ${timeoutMs}ms`))
        // A hung onnx call can't be cancelled; kill so the next call respawns.
        child.kill()
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer })
      const request: MlWorkerRequest = { id, ...body }
      child.postMessage(request)
    })
  }

  private settle(message: MlWorkerResponse): void {
    const entry = this.pending.get(message.id)
    if (!entry) return
    this.pending.delete(message.id)
    clearTimeout(entry.timer)
    if (message.ok) entry.resolve(message.result)
    else entry.reject(new Error(message.error))
  }

  private failPending(error: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.pending.clear()
  }
}
