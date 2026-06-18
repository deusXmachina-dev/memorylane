import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { StorageService } from '../storage'
import { applyMigrations } from '../storage/migrator'
import { deleteDbFiles } from '../storage/test-utils'
import type { StoredActivity } from '../storage/types'
import { getDayBoundaries } from '../services/pattern-detector/helpers'
import { runDetection } from '../services/task-miner/run-detection'
import type { EmbeddingService } from '../processor/embedding'
import type { InferenceProvider } from '../llm'
import { readJsonl } from './jsonl'
import { loadTaskGoldenMd } from './task-golden-md'
import type {
  DetectedSighting,
  TaskFixture,
  TaskFixtureActivity,
  TaskFixtureManifest,
  TaskRunResult,
} from './task-types'

/**
 * Loads + replays a task-mining fixture.
 *
 * Like the pattern eval before it, the miner reads activities from a SQLite
 * StorageService DB, so a fixture is seeded into a fresh temp DB — each activity
 * gets a real 384-d embedding so the `search_similar_activities` grounding tool
 * works — then the REAL `runDetection` runs against it. Only the LLM call is the
 * variable. Sightings are read back by the run id `runDetection` returns.
 */

/** Reads manifest.json + activities.jsonl + golden.md from a fixture dir. */
export function loadTaskFixture(dir: string): TaskFixture {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'),
  ) as TaskFixtureManifest
  const activities = readJsonl<TaskFixtureActivity>(path.join(dir, 'activities.jsonl')).sort(
    (a, b) => a.offsetMin - b.offsetMin,
  )
  const golden = loadTaskGoldenMd(path.join(dir, 'golden.md')) ?? { sightings: [] }
  return { dir, manifest, activities, golden }
}

export interface SeedOptions {
  embedder: EmbeddingService
  lookbackDays: number
}

/**
 * Seeds a fresh temp DB with the fixture's activities, placing each on the
 * target day (`dayStart + offsetMin*60_000`) so it lands inside the window the
 * miner queries. Caller must `storage.close()` + `deleteDbFiles(dbPath)`.
 */
export async function seedFixtureDb(
  activities: TaskFixtureActivity[],
  { embedder, lookbackDays }: SeedOptions,
): Promise<{ storage: StorageService; dbPath: string }> {
  const dbPath = path.join(
    os.tmpdir(),
    `eval-tasks-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`,
  )
  deleteDbFiles(dbPath)
  const storage = new StorageService(dbPath)
  applyMigrations(storage.getDatabase())

  const { start } = getDayBoundaries(lookbackDays)
  for (const a of activities) {
    const startTimestamp = start + a.offsetMin * 60_000
    const endTimestamp = startTimestamp + a.durationMin * 60_000
    const vector = await embedder.generateEmbedding(`${a.summary} ${a.ocrText}`.trim())
    storage.activities.add({
      id: a.id,
      startTimestamp,
      endTimestamp,
      appName: a.app,
      windowTitle: a.windowTitle,
      tld: a.tld,
      summary: a.summary,
      summaryModel: 'fixture',
      summaryMode: '',
      summaryReason: '',
      summaryFailureDetail: '',
      ocrText: a.ocrText,
      vector,
    } satisfies StoredActivity)
  }

  return { storage, dbPath }
}

/** Reads the sightings produced by a mining run back out of the DB. */
function collectDetected(storage: StorageService, runId: string): DetectedSighting[] {
  return storage.sightings.getByRunId(runId).map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    apps: s.apps,
    activityIds: s.activityIds,
    interactionMin: s.interactionMin,
  }))
}

export interface RunFixtureParams {
  provider: InferenceProvider
  fixture: TaskFixture
  model: string
  lookbackDays: number
  embedder: EmbeddingService
  onProgress?: (msg: string) => void
}

/** Seeds a fixture, runs the real miner against it, returns its sightings. */
export async function runTaskFixture(params: RunFixtureParams): Promise<TaskRunResult> {
  const { storage, dbPath } = await seedFixtureDb(params.fixture.activities, {
    embedder: params.embedder,
    lookbackDays: params.lookbackDays,
  })
  try {
    const run = await runDetection(
      params.provider,
      storage,
      params.embedder,
      { model: params.model, lookbackDays: params.lookbackDays },
      params.onProgress,
    )
    return {
      detected: collectDetected(storage, run.runId),
      tokenUsage: run.tokenUsage,
      candidatesFromScan: run.candidatesFromScan,
      candidatesKept: run.candidatesKept,
      candidatesRejected: run.candidatesRejected,
    }
  } finally {
    storage.close()
    deleteDbFiles(dbPath)
  }
}
