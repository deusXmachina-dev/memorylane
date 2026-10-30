import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { StorageService } from '@main/storage'
import { applyMigrations } from '@main/storage/migrator'
import { createStoredActivity, deleteDbFiles, v } from '@main/storage/test-utils'
import { ActivityReembedder } from './activity-reembedder'
import { HEURISTIC_VIEWED_MODEL } from './embedding-text'

describe('ActivityReembedder', () => {
  const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_reembedder_test.db')
  let storage: StorageService
  let embedded: string[]
  const embedder = {
    embedBatch: async (texts: string[]) => {
      embedded.push(...texts)
      return texts.map(() => v(0, 0, 1))
    },
  }

  beforeEach(() => {
    deleteDbFiles(TEST_DB_PATH)
    storage = new StorageService(TEST_DB_PATH)
    applyMigrations(storage.getDatabase())
    embedded = []
    storage.activities.add(createStoredActivity({ id: 'a', summary: 'Wrote report', ocrText: 'x' }))
    storage.activities.add(
      createStoredActivity({
        id: 'b',
        summary: 'Viewed Inbox',
        summaryModel: HEURISTIC_VIEWED_MODEL,
        ocrText: 'Faktura od Alzy',
      }),
    )
    storage.activities.add(createStoredActivity({ id: 'c', summary: '', ocrText: 'screen text' }))
  })

  afterEach(() => {
    storage.close()
    deleteDbFiles(TEST_DB_PATH)
  })

  it('re-embeds every activity with the production text and records the model', async () => {
    await new ActivityReembedder(storage, embedder, 'new-model').run()

    expect(embedded).toEqual(['Wrote report', 'Faktura od Alzy', 'screen text'])
    expect(storage.activities.getVectorsByIds(['a', 'b', 'c']).get('b')).toEqual(v(0, 0, 1))
    expect(storage.embeddingState.get()).toMatchObject({
      activityModel: 'new-model',
      activityCursor: 0,
    })
  })

  it('resumes after the cursor', async () => {
    const [first] = storage.activities.getEmbeddingSources(0, 1)
    storage.embeddingState.setActivityCursor(first.rowid)

    await new ActivityReembedder(storage, embedder, 'new-model').run()

    expect(embedded).toEqual(['Faktura od Alzy', 'screen text'])
  })

  it('does nothing when vectors already match the model', async () => {
    storage.embeddingState.setActivityModel('new-model')

    await new ActivityReembedder(storage, embedder, 'new-model').run()

    expect(embedded).toEqual([])
  })

  it('treats a purged database as current', async () => {
    storage.purge()

    await new ActivityReembedder(storage, embedder, 'new-model').run()

    expect(storage.embeddingState.get()).toBeNull()
    expect(embedded).toEqual([])
  })
})
