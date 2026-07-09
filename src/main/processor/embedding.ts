import { pipeline, env } from '@huggingface/transformers'
import log from '@main/utils/logger'
import type { ActivityEmbeddingService } from '@main/activity/activity-transformer-types'
import { getBundledModelPath, getModelCacheDir } from '@main/utils/paths'

// 'all-MiniLM-L6-v2' is a good balance of speed and quality for local embeddings.
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'
const MODEL_DIM = 384

let resolvedBundledPath: string | null = null
let maxInferenceThreads: number | null = null
let envConfigured = false

/**
 * Point transformers.js at the model files. Without options this resolves
 * paths for the current process; the ml-worker passes paths resolved by the
 * main process instead (a utilityProcess has no `app`). First call wins.
 * `maxThreads` caps onnx's intra-op pool — uncapped it takes every core,
 * which makes the whole machine jank during a backlog rebuild on weak
 * hardware. Batch scripts (enode) leave it unset for full speed.
 */
export function configureModelEnv(opts?: {
  bundledModelPath: string | null
  cacheDir: string
  maxThreads?: number | null
}): void {
  if (envConfigured) return
  envConfigured = true
  resolvedBundledPath = opts ? opts.bundledModelPath : getBundledModelPath()
  maxInferenceThreads = opts?.maxThreads ?? null
  if (resolvedBundledPath) {
    env.localModelPath = resolvedBundledPath
    env.allowRemoteModels = false
  } else {
    env.cacheDir = opts ? opts.cacheDir : getModelCacheDir()
  }
}

export class EmbeddingService implements ActivityEmbeddingService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipe: any = null

  /**
   * Initializes the embedding model.
   * Downloads the model if not cached.
   */
  public async init(): Promise<void> {
    if (this.pipe) return

    configureModelEnv()
    if (resolvedBundledPath) {
      log.debug(`Using bundled embedding model from ${resolvedBundledPath}`)
    } else {
      log.debug(`Using remote embedding model from ${env.cacheDir}`)
    }
    log.debug(`Loading embedding model: ${MODEL_NAME}`)
    try {
      this.pipe = await pipeline('feature-extraction', MODEL_NAME, {
        dtype: 'fp32',
        ...(maxInferenceThreads !== null && {
          session_options: { intraOpNumThreads: maxInferenceThreads, interOpNumThreads: 1 },
        }),
      })
      log.debug('Embedding model loaded.')
    } catch (error) {
      const modelRoot = resolvedBundledPath ?? env.cacheDir ?? '(unknown cache dir)'
      log.error(
        `[EmbeddingService] Failed to load model ${MODEL_NAME} from ${modelRoot}. ` +
          'Embedding generation will fail until the model cache is fixed.',
        error,
      )
      throw error
    }
  }

  /**
   * Generates a vector embedding for the given text.
   * @param text The text to embed.
   * @returns A 384-dimensional vector (for all-MiniLM-L6-v2).
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text])
    return vector
  }

  public async embed(text: string): Promise<number[]> {
    return this.generateEmbedding(text)
  }

  /**
   * Embeds many texts in one model call. Blank texts get a zero vector
   * (same contract as generateEmbedding) without touching the model.
   */
  public async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const vectors: number[][] = new Array(texts.length)
    const nonEmpty: { index: number; text: string }[] = []
    for (let i = 0; i < texts.length; i++) {
      if (!texts[i] || texts[i].trim().length === 0) {
        vectors[i] = new Array<number>(MODEL_DIM).fill(0)
      } else {
        nonEmpty.push({ index: i, text: texts[i] })
      }
    }

    if (nonEmpty.length > 0) {
      if (!this.pipe) await this.init()
      const result = await this.pipe(
        nonEmpty.map((e) => e.text),
        { pooling: 'mean', normalize: true },
      )
      // result.data is one flat Float32Array; result.dims is [batch, dim].
      const dims = result.dims[result.dims.length - 1] as number
      const data = result.data as Float32Array
      nonEmpty.forEach((e, row) => {
        vectors[e.index] = Array.from(data.subarray(row * dims, (row + 1) * dims))
      })
    }

    return vectors
  }
}
