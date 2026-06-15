import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { StorageService } from '../storage'
import { applyMigrations } from '../storage/migrator'
import { deleteDbFiles } from '../storage/test-utils'
import type { StoredActivity } from '../storage/types'
import { getDayBoundaries } from '../services/pattern-detector/helpers'
import { runDetection } from '../services/pattern-detector/run-detection'
import type { EmbeddingService } from '../processor/embedding'
import type { InferenceProvider } from '../llm'
import { readJsonl } from './jsonl'
import type {
  DetectedPattern,
  FixtureActivity,
  PatternFixture,
  PatternFixtureManifest,
  PatternGolden,
  PatternRunResult,
} from './pattern-types'

/**
 * Loads + replays a pattern-detection fixture.
 *
 * Unlike the summary eval (which replays frames through the producer), the
 * detector reads activities from a SQLite StorageService DB. So a fixture is
 * seeded into a fresh temp DB — each activity gets a real 384-d embedding so the
 * `search_similar_activities` verification tool works — then the REAL
 * `runDetection` runs against it. Only the LLM call is the variable.
 */

/** Reads manifest.json + activities.jsonl + golden.json from a fixture dir. */
export function loadPatternFixture(dir: string): PatternFixture {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'),
  ) as PatternFixtureManifest
  const activities = readJsonl<FixtureActivity>(path.join(dir, 'activities.jsonl'))
  const golden = JSON.parse(fs.readFileSync(path.join(dir, 'golden.json'), 'utf8')) as PatternGolden
  return { dir, manifest, activities, golden }
}

export interface SeedOptions {
  embedder: EmbeddingService
  lookbackDays: number
}

/**
 * Seeds a fresh temp DB with the fixture's activities, placing each on the
 * target day (`dayStart + offsetMin*60_000`) so it lands inside the window the
 * detector queries. Caller must `storage.close()` + `deleteDbFiles(dbPath)`.
 */
export async function seedFixtureDb(
  activities: FixtureActivity[],
  { embedder, lookbackDays }: SeedOptions,
): Promise<{ storage: StorageService; dbPath: string }> {
  const dbPath = path.join(
    os.tmpdir(),
    `eval-patterns-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`,
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
      ocrText: a.ocrText,
      vector,
    } satisfies StoredActivity)
  }

  return { storage, dbPath }
}

/** Reads every active pattern + its sightings back out of the DB. */
function collectDetected(storage: StorageService): DetectedPattern[] {
  return storage.patterns.getAllPatterns().map((p) => {
    const detail = storage.patterns.getPatternDetail(p.id)
    const sightings = (detail?.sightings ?? []).map((s) => ({
      activityIds: s.activityIds,
      confidence: s.confidence,
      evidence: s.evidence,
      durationEstimateMin: s.durationEstimateMin,
    }))
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      apps: p.apps,
      automationIdea: p.automationIdea,
      sightingCount: p.sightingCount,
      sightings,
    }
  })
}

export interface RunFixtureParams {
  provider: InferenceProvider
  fixture: PatternFixture
  model: string
  lookbackDays: number
  embedder: EmbeddingService
  onProgress?: (msg: string) => void
}

/** Seeds a fixture, runs the real detector against it, returns its patterns. */
export async function runPatternFixture(params: RunFixtureParams): Promise<PatternRunResult> {
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
      detected: collectDetected(storage),
      tokenUsage: run.tokenUsage,
      candidatesFromScan: run.candidatesFromScan,
      candidatesVerified: run.candidatesKept,
      candidatesRejected: run.candidatesRejected,
    }
  } finally {
    storage.close()
    deleteDbFiles(dbPath)
  }
}
