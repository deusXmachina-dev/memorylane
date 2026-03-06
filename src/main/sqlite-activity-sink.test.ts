import { describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import type { ActivityRepository } from './storage/activity-repository'
import { StorageService } from './storage'
import { applyMigrations } from './storage/migrator'
import type { ExtractedActivity } from './activity-extraction-types'
import type { Activity } from './activity-types'
import { SqliteActivitySink } from './sqlite-activity-sink'

function makeActivity(id: string): Activity {
  return {
    id,
    startTimestamp: 1_000,
    endTimestamp: 2_000,
    context: {
      appName: 'Code',
      windowTitle: 'main.ts',
      bundleId: 'com.microsoft.VSCode',
    },
    interactions: [],
    frames: [],
    provenance: {
      eventWindowOffsets: [],
      frameOffsets: [],
      sourceWindowIds: [],
      sourceClosedBy: [],
    },
  }
}

function makeExtracted(activityId: string): ExtractedActivity {
  return {
    activityId,
    startTimestamp: 1_000,
    endTimestamp: 2_000,
    appName: 'Code',
    windowTitle: 'main.ts',
    tld: undefined,
    summary: 'Edited source file',
    ocrText: 'function test() {}',
    vector: [0.1, 0.2, 0.3],
  }
}

describe('SqliteActivitySink', () => {
  it('persists mapped extracted activity', async () => {
    const add = vi.fn()
    const repo = { add } as unknown as ActivityRepository
    const sink = new SqliteActivitySink(repo)
    const activity = makeActivity('activity-1')
    const extracted = makeExtracted('activity-1')

    await sink.persist({ activity, extracted })

    expect(add).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledWith({
      id: 'activity-1',
      startTimestamp: 1_000,
      endTimestamp: 2_000,
      appName: 'Code',
      windowTitle: 'main.ts',
      tld: null,
      summary: 'Edited source file',
      ocrText: 'function test() {}',
      vector: [0.1, 0.2, 0.3],
    })
  })

  it('throws on activityId mismatch', async () => {
    const add = vi.fn()
    const repo = { add } as unknown as ActivityRepository
    const sink = new SqliteActivitySink(repo)
    const activity = makeActivity('activity-1')
    const extracted = makeExtracted('activity-2')

    await expect(sink.persist({ activity, extracted })).rejects.toThrow('activityId mismatch')
    expect(add).not.toHaveBeenCalled()
  })

  it('ignores duplicate insert error', async () => {
    const add = vi.fn().mockImplementation(() => {
      throw new Error('UNIQUE constraint failed: activities.id')
    })
    const repo = { add } as unknown as ActivityRepository
    const sink = new SqliteActivitySink(repo)
    const activity = makeActivity('activity-1')
    const extracted = makeExtracted('activity-1')

    await expect(sink.persist({ activity, extracted })).resolves.toBeUndefined()
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('rethrows non-duplicate storage errors', async () => {
    const storageError = new Error('database unavailable')
    const add = vi.fn().mockImplementation(() => {
      throw storageError
    })
    const repo = { add } as unknown as ActivityRepository
    const sink = new SqliteActivitySink(repo)
    const activity = makeActivity('activity-1')
    const extracted = makeExtracted('activity-1')

    await expect(sink.persist({ activity, extracted })).rejects.toBe(storageError)
  })

  it('persists to real sqlite storage', async () => {
    const testDbPath = path.join(process.cwd(), 'temp_sqlite_activity_sink.db')
    const deleteDbFiles = (): void => {
      for (const suffix of ['', '-wal', '-shm']) {
        const filepath = testDbPath + suffix
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath)
        }
      }
    }

    deleteDbFiles()

    const storage = new StorageService(testDbPath)
    applyMigrations(storage.getDatabase())
    const sink = new SqliteActivitySink(storage.activities)
    const activity = makeActivity('real-storage-1')
    const extracted = makeExtracted('real-storage-1')
    extracted.vector = Object.assign(new Array(384).fill(0), [0.1, 0.2, 0.3])

    try {
      await sink.persist({ activity, extracted })

      const rows = storage.activities.getByIds(['real-storage-1'])
      expect(rows).toHaveLength(1)
      expect(rows[0]).toEqual(
        expect.objectContaining({
          id: 'real-storage-1',
          startTimestamp: 1_000,
          endTimestamp: 2_000,
          appName: 'Code',
          windowTitle: 'main.ts',
          tld: null,
          summary: 'Edited source file',
          ocrText: 'function test() {}',
        }),
      )
      expect(rows[0].vector).toHaveLength(384)
      expect(rows[0].vector[0]).toBeCloseTo(0.1, 5)
      expect(rows[0].vector[1]).toBeCloseTo(0.2, 5)
      expect(rows[0].vector[2]).toBeCloseTo(0.3, 5)
    } finally {
      storage.close()
      deleteDbFiles()
    }
  })
})
