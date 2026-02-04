import { pipeline, env } from '@xenova/transformers';

// Configure environment to not use local file system for models if possible,
// or set a valid cache directory. For Electron, we want to ensure we don't
// fail due to path permissions.
// 'all-MiniLM-L6-v2' is a good balance of speed and quality for local embeddings.
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

// Prevent transformers from trying to download from a browser cache location in Node env
env.cacheDir = './.cache/transformers';

export class EmbeddingService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipe: any = null;

  /**
   * Initializes the embedding model.
   * Downloads the model if not cached.
   */
  public async init(): Promise<void> {
    if (this.pipe) return;
    
    console.log(`Loading embedding model: ${MODEL_NAME}`);
    this.pipe = await pipeline('feature-extraction', MODEL_NAME);
    console.log('Embedding model loaded.');
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
        return new Array(384).fill(0);
    }

    if (!this.pipe) {
      await this.init();
    }

    // Run the model
    const result = await this.pipe(text, { pooling: 'mean', normalize: true });
    
    // The result is a Tensor. We need to convert it to a plain array.
    // result.data is a Float32Array.
    return Array.from(result.data);
  }
}
