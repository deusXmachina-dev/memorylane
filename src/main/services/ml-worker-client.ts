import { app, utilityProcess } from 'electron'
import type { UtilityProcess } from 'electron'
import * as os from 'os'
import * as path from 'path'
import log from '@main/utils/logger'
import { getBundledModelPath, getModelCacheDir } from '@main/utils/paths'
import { isWorkerLogEvent, logWorkerEvent, type WorkerLogEvent } from '@main/utils/worker-log'
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

// First run may download the ~100 MB model (transformers.js restarts partial
// downloads from zero), so init gets a very generous bound — slow connections
// must not abort app startup.
const INIT_TIMEOUT_MS = 15 * 60 * 1000
const EMBED_TIMEOUT_MS = 60 * 1000
const CLUSTER_TIMEOUT_MS = 2 * 60 * 1000
const RESPAWN_WINDOW_MS = 60 * 1000
const MAX_SPAWNS_PER_WINDOW = 3

interface PendingRequest {
  /** The child the request was posted to — a stale child's exit must not
   * fail requests already riding on its replacement. */
  child: UtilityProcess
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
  private disposed = false

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
    this.disposed = true
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
    await this.waitForSpawnSlot()
    // A previous child may be killed-but-not-yet-exited; never leave one alive.
    this.child?.kill()

    const child = utilityProcess.fork(workerScriptPath(), [], { serviceName: 'ml-worker' })
    this.child = child

    child.on('message', (message: MlWorkerResponse | WorkerLogEvent) => {
      if (isWorkerLogEvent(message)) return logWorkerEvent('MlWorker', message)
      this.settle(message)
    })
    child.on('exit', (code) => {
      // Logged even with nothing in flight, or a crash-respawn cycle between
      // requests would leave no trace. Quiet on app shutdown.
      if (!this.disposed) log.warn(`[MlWorker] Worker exited (code ${code})`)
      if (this.child === child) {
        this.child = null
        this.ready = null
      }
      this.failPendingFor(child, new Error(`ml-worker exited (code ${code})`))
    })

    try {
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

      // The worker has no `app`; hand it paths this process resolved. Half the
      // cores for inference keeps the rest of the machine responsive during a
      // backlog rebuild — the UI matters more than embedding throughput.
      const result = await this.request(
        {
          type: 'init',
          bundledModelPath: getBundledModelPath(),
          cacheDir: getModelCacheDir(),
          maxThreads: Math.max(1, Math.floor(os.availableParallelism() / 2)),
        },
        INIT_TIMEOUT_MS,
      )
      if (result.type !== 'ready') throw new Error('ml-worker: bad init response')
      log.info('[MlWorker] Worker ready (embedding model loaded)')
    } catch (error) {
      // The worker survives its own init failure (it just keeps listening),
      // so kill it here or the next spawn would orphan it alive.
      if (this.child === child) {
        this.child = null
        this.ready = null
      }
      child.kill()
      throw error
    }
  }

  /**
   * Paces respawns instead of failing fast: the live activity pipeline only
   * retries an embed for ~300ms before dead-lettering the activity, so a
   * worker crash loop must degrade to slow retries, not data loss.
   */
  private async waitForSpawnSlot(): Promise<void> {
    let now = Date.now()
    this.spawnTimes = this.spawnTimes.filter((t) => now - t < RESPAWN_WINDOW_MS)
    if (this.spawnTimes.length >= MAX_SPAWNS_PER_WINDOW) {
      const waitMs = this.spawnTimes[0] + RESPAWN_WINDOW_MS - now
      log.warn(`[MlWorker] Respawning too fast; delaying next spawn by ${waitMs}ms`)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
      now = Date.now()
      this.spawnTimes = this.spawnTimes.filter((t) => now - t < RESPAWN_WINDOW_MS)
    }
    this.spawnTimes.push(now)
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
      this.pending.set(id, { child, resolve, reject, timer })
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

  private failPendingFor(child: UtilityProcess, error: Error): void {
    for (const [id, entry] of this.pending) {
      if (entry.child !== child) continue
      this.pending.delete(id)
      clearTimeout(entry.timer)
      entry.reject(error)
    }
  }
}
