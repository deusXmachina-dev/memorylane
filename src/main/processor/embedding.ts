import * as path from 'path'
import * as os from 'os'
import { pipeline, env } from '@huggingface/transformers'
import log from '../logger'
import type { ActivityEmbeddingService } from '../activity-transformer-types'

// 'all-MiniLM-L6-v2' is a good balance of speed and quality for local embeddings.
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'

// Use an absolute cache path under the app's data directory.
// A relative path like './.cache' breaks when the cwd is '/' (macOS launches
// packaged apps with cwd='/'), causing ENOENT on mkdir.
function getModelCacheDir(): string {
  if (process.versions.electron) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require('electron')
      if (app) return path.join(app.getPath('userData'), 'models')
    } catch {
      // ELECTRON_RUN_AS_NODE or app not ready — fall through
    }
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'memorylane', 'models')
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || os.homedir(), 'memorylane', 'models')
  }
  return path.join(os.homedir(), '.config', 'memorylane', 'models')
}

env.cacheDir = getModelCacheDir()

export class EmbeddingService implements ActivityEmbeddingService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipe: any = null

  /**
   * Initializes the embedding model.
   * Downloads the model if not cached.
   */
  public async init(): Promise<void> {
    if (this.pipe) return

    log.info(`Loading embedding model: ${MODEL_NAME}`)
    this.pipe = await pipeline('feature-extraction', MODEL_NAME)
    log.info('Embedding model loaded.')
  }

  /**
   * Generates a vector embedding for the given text.
   * @param text The text to embed.
   * @returns A 384-dimensional vector (for all-MiniLM-L6-v2).
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      // Return zero vector or handle empty text gracefully
      // For simplicity, we return a zero vector of correct dimension (384)
      return new Array(384).fill(0)
    }

    if (!this.pipe) {
      await this.init()
    }

    // Run the model
    const result = await this.pipe(text, { pooling: 'mean', normalize: true })

    // The result is a Tensor. We need to convert it to a plain array.
    // result.data is a Float32Array.
    return Array.from(result.data)
  }

  public async embed(text: string): Promise<number[]> {
    return this.generateEmbedding(text)
  }
}
