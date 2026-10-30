import { AutoModel, AutoTokenizer, env } from '@huggingface/transformers'
import log from '@main/utils/logger'
import type { ActivityEmbeddingService } from '@main/activity/activity-transformer-types'
import { getBundledModelPath, getModelCacheDir } from '@main/utils/paths'
import { EMBEDDING_MODEL } from './embedding-model'

const MODEL_DIM = 384
const MAX_TOKENS = 512

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
  private tokenizer: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private model: any = null

  /**
   * Initializes the embedding model.
   * Downloads the model if not cached.
   */
  public async init(): Promise<void> {
    if (this.model) return

    configureModelEnv()
    if (resolvedBundledPath) {
      log.debug(`Using bundled embedding model from ${resolvedBundledPath}`)
    } else {
      log.debug(`Using remote embedding model from ${env.cacheDir}`)
    }
    log.debug(`Loading embedding model: ${EMBEDDING_MODEL}`)
    try {
      this.tokenizer = await AutoTokenizer.from_pretrained(EMBEDDING_MODEL)
      this.model = await AutoModel.from_pretrained(EMBEDDING_MODEL, {
        dtype: 'q8',
        ...(maxInferenceThreads !== null && {
          session_options: { intraOpNumThreads: maxInferenceThreads, interOpNumThreads: 1 },
        }),
      })
      log.debug('Embedding model loaded.')
    } catch (error) {
      const modelRoot = resolvedBundledPath ?? env.cacheDir ?? '(unknown cache dir)'
      log.error(
        `[EmbeddingService] Failed to load model ${EMBEDDING_MODEL} from ${modelRoot}. ` +
          'Embedding generation will fail until the model cache is fixed.',
        error,
      )
      throw error
    }
  }

  /**
   * Generates a vector embedding for the given text.
   * @param text The text to embed.
   * @returns A 384-dimensional, L2-normalized vector.
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text])
    return vector
  }

  public async embed(text: string): Promise<number[]> {
    return this.generateEmbedding(text)
  }

  /**
   * Blank texts get a zero vector. One text per model call: padding shifts q8
   * activations, so batched vectors would depend on their neighbours.
   */
  public async embedBatch(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = []
    for (const text of texts) {
      if (!text || text.trim().length === 0) {
        vectors.push(new Array<number>(MODEL_DIM).fill(0))
        continue
      }
      if (!this.model) await this.init()
      const inputs = this.tokenizer(text, { truncation: true, max_length: MAX_TOKENS })
      const { last_hidden_state: hidden } = await this.model(inputs)
      const dim = hidden.dims[2] as number
      const cls = (hidden.data as Float32Array).subarray(0, dim)
      const norm = Math.hypot(...cls) || 1
      vectors.push(Array.from(cls, (x) => x / norm))
    }
    return vectors
  }
}
