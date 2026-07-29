import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { v5 as uuidv5 } from 'uuid'
import { StorageService } from '../storage'
import { applyMigrations } from '../storage/migrator'
import { deleteDbFiles } from '../storage/test-utils'
import type { StoredActivity } from '../storage/types'
import { getDayBoundaries } from '@main/utils/day'
import { runDetection } from '../services/task-miner/run-detection'
import { DEFAULT_MINER_CONFIG } from '@main/services/task-miner/types'
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

/** Fixed namespace so a fixture id always maps to the same opaque served id. */
const EVAL_ID_NAMESPACE = 'b3f2a6d4-8e7c-5f1a-9c2b-0d1e2f3a4b5c'

/**
 * The opaque id a fixture activity is served to the miner under. Deterministic
 * (same fixture id → same served id) but carries none of the fixture id's signal
 * — no `jaro-` prefix, no ordinal, no `-oN` occurrence tag — so the model can't
 * tell planted activities from noise, or their order/cluster, by id alone.
 */
export function servedActivityId(fixtureId: string): string {
  return uuidv5(fixtureId, EVAL_ID_NAMESPACE)
}

/**
 * Seeds a fresh temp DB with the fixture's activities, placing each on the
 * target day (`dayStart + offsetMin*60_000`) so it lands inside the window the
 * miner queries. Caller must `storage.close()` + `deleteDbFiles(dbPath)`.
 */
export async function seedFixtureDb(
  activities: TaskFixtureActivity[],
  { embedder, lookbackDays }: SeedOptions,
): Promise<{ storage: StorageService; dbPath: string; restoreId: Map<string, string> }> {
  const dbPath = path.join(
    os.tmpdir(),
    `eval-tasks-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`,
  )
  deleteDbFiles(dbPath)
  const storage = new StorageService(dbPath)
  applyMigrations(storage.getDatabase())

  // The scan prompt serializes each activity's `id` verbatim, so a fixture's
  // readable ids (`jaro-2026-06-19-02` — sequential, occurrence-tagged) would tell
  // the model which activities are the planted task, in what order, and which
  // recurrence they belong to. Remint every activity to an opaque, deterministic
  // id before it reaches the DB (and thus the model), keeping a map to restore the
  // readable ids for scoring/reports. Planted and noise become id-indistinguishable.
  const restoreId = new Map<string, string>()

  const { start } = getDayBoundaries(lookbackDays)
  for (const a of activities) {
    const servedId = servedActivityId(a.id)
    restoreId.set(servedId, a.id)
    const startTimestamp = start + a.offsetMin * 60_000
    const endTimestamp = startTimestamp + a.durationMin * 60_000
    const vector = await embedder.generateEmbedding(`${a.summary} ${a.ocrText}`.trim())
    storage.activities.add({
      id: servedId,
      startTimestamp,
      endTimestamp,
      appName: a.app,
      windowTitle: a.windowTitle,
      tld: a.tld,
      summary: a.summary,
      summaryModel: 'fixture',
      ocrText: a.ocrText,
      vector,
    } satisfies StoredActivity)
  }

  return { storage, dbPath, restoreId }
}

/** Reads the sightings produced by a mining run back out of the DB. */
function collectDetected(storage: StorageService, runId: string): DetectedSighting[] {
  return storage.sightings.getByRunId(runId).map((s) => ({
    id: s.id,
    title: s.title,
    subject: s.subject,
    description: s.description,
    steps: s.steps,
    apps: s.apps,
    activityIds: s.activityIds,
    activeMin: s.activeMin,
  }))
}

export interface RunFixtureParams {
  provider: InferenceProvider
  fixture: TaskFixture
  model: string
  lookbackDays: number
  embedder: EmbeddingService
  /** Skip Phase 2 grounding — the scan's candidates are written directly. */
  scanOnly?: boolean
  onProgress?: (msg: string) => void
}

/** Seeds a fixture, runs the real miner against it, returns its sightings. */
export async function runTaskFixture(params: RunFixtureParams): Promise<TaskRunResult> {
  const { storage, dbPath, restoreId } = await seedFixtureDb(params.fixture.activities, {
    embedder: params.embedder,
    lookbackDays: params.lookbackDays,
  })
  try {
    const run = await runDetection(
      params.provider,
      storage,
      params.embedder,
      {
        model: params.model,
        lookbackDays: params.lookbackDays,
        scanOnly: params.scanOnly ?? DEFAULT_MINER_CONFIG.scanOnly,
      },
      params.onProgress,
    )
    // Restore readable fixture ids on the miner's output so the scorer, judge, and
    // reports share golden.md's id space (the model only ever saw opaque ids).
    const detected = collectDetected(storage, run.runId).map((s) => ({
      ...s,
      activityIds: s.activityIds.map((id) => restoreId.get(id) ?? id),
    }))
    return {
      detected,
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
