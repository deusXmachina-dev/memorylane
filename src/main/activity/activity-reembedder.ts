import type { StorageService } from '@main/storage'
import log from '@main/utils/logger'
import { embeddingText } from './embedding-text'

const BATCH_SIZE = 32

/** Re-embeds stored activities after an embedding model change, resuming from a rowid cursor. */
export class ActivityReembedder {
  private stopped = false
  private done: Promise<void> = Promise.resolve()

  constructor(
    private readonly storage: StorageService,
    private readonly embedder: { embedBatch(texts: string[]): Promise<number[][]> },
    private readonly model: string,
  ) {}

  start(): void {
    this.done = this.run().catch((error) => {
      if (!this.stopped) log.error('[ActivityReembedder] Re-embedding failed:', error)
    })
  }

  stop(): Promise<void> {
    this.stopped = true
    return this.done
  }

  async run(): Promise<void> {
    const state = this.storage.embeddingState.get()
    if (!state || state.activityModel === this.model) return

    log.info(`[ActivityReembedder] Re-embedding activities: ${state.activityModel} → ${this.model}`)
    let cursor = state.activityCursor
    let total = 0
    while (!this.stopped) {
      const batch = this.storage.activities.getEmbeddingSources(cursor, BATCH_SIZE)
      if (batch.length === 0) {
        this.storage.embeddingState.setActivityModel(this.model)
        log.info(`[ActivityReembedder] Done: ${total} activities`)
        return
      }
      const vectors = await this.embedder.embedBatch(batch.map(embeddingText))
      if (this.stopped) return
      cursor = batch[batch.length - 1].rowid
      this.storage.getDatabase().transaction(() => {
        this.storage.activities.replaceVectors(
          batch.map((a, i) => ({ id: a.id, vector: vectors[i] })),
        )
        this.storage.embeddingState.setActivityCursor(cursor)
      })()
      total += batch.length
    }
  }
}
