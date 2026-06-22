/**
 * Promotes a captured session (the debug-pipeline JSONL streams + their PNGs)
 * into a committed replay fixture. Shared by the `promote-debug-fixture` CLI and
 * the in-app eval recorder — both hand it a directory containing
 * `event-windows.jsonl` + `frames.jsonl` (the CLI's `.debug-pipeline`, or the
 * recorder's per-session staging dir) and get back a self-contained fixture.
 *
 * The fixture is: event windows copied verbatim (the replay-critical input),
 * referenced PNGs copied in with paths rewritten to relative, a `manifest.json`,
 * an optional `session.mp4` for review, and an optional editable `golden.md`
 * scaffold. Summaries come from the live pipeline's `activities.jsonl` when the
 * in-app recorder captured one; otherwise (CLI) from a deterministic no-LLM
 * replay with a DB time-overlap backfill. No LLM is called here.
 */

import * as fs from 'fs'
import * as path from 'path'
import sharp from 'sharp'
import { SCREEN_CAPTURER_CONFIG } from '../../shared/constants'
import { FfmpegVideoStitcher } from '../video/video-stitcher'
import { StorageService } from '../storage'
import type { ActivityDetail } from '../storage/types'
import type { EventWindow } from '../../shared/types'
import { renderGoldenMd } from './golden-md'
import { replayFixture, ScaffoldTransformer } from './replay-harness'
import { readJsonl } from './jsonl'
import {
  FIXTURE_SCHEMA_VERSION,
  type DumpedActivity,
  type DumpedFrame,
  type FixtureManifest,
  type ReplayActivity,
} from './types'

export interface PromoteCaptureOptions {
  /** Dir holding `event-windows.jsonl` + `frames.jsonl` (`.debug-pipeline` or staging). */
  sourceDir: string
  /** Where `<name>/` is created (e.g. `{userData}/eval-fixtures` or `evals/.../fixtures`). */
  fixturesRoot: string
  name: string
  label?: string
  description?: string
  /** Re-encode PNGs to smaller JPEGs (affects OCR/snapshot pixels uniformly). */
  downsample?: boolean
  /** Stitch a `session.mp4` for review. Default true. */
  video?: boolean
  /** Seed an editable `golden.md`. Default true; never overwrites unless `reseed`. */
  seed?: boolean
  reseed?: boolean
  expectedActivities?: number
  /** Pre-fill golden summaries from the DB. Default true (when a DB is reachable). */
  dbSummaries?: boolean
  /** Live storage to read summaries from (in-app). Not closed by this function. */
  storage?: StorageService
  /** DB path to open for summaries (CLI). Ignored when `storage` is given. */
  dbPath?: string
}

export interface PromoteCaptureResult {
  fixtureDir: string
  frameCount: number
  missingFrames: number
  eventWindowCount: number
  appMix: string[]
  downsampled: boolean
  video: { ok: boolean; durationMs?: number; error?: string } | null
  golden: { seeded: boolean; kept: number; dropped: number; summariesFilled: number } | null
}

async function copyFrame(
  srcPath: string,
  destDir: string,
  downsample: boolean,
): Promise<{ relPath: string } | null> {
  if (!fs.existsSync(srcPath)) return null
  const base = path.basename(srcPath)

  if (!downsample) {
    fs.copyFileSync(srcPath, path.join(destDir, base))
    return { relPath: path.posix.join('frames', base) }
  }

  const jpgName = base.replace(/\.[^.]+$/, '') + '.jpg'
  await sharp(srcPath)
    .resize({
      width: SCREEN_CAPTURER_CONFIG.MAX_DIMENSION_PX,
      height: SCREEN_CAPTURER_CONFIG.MAX_DIMENSION_PX,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toFile(path.join(destDir, jpgName))
  return { relPath: path.posix.join('frames', jpgName) }
}

function deriveAppMix(windows: EventWindow[]): string[] {
  const apps = new Set<string>()
  for (const w of windows) {
    for (const e of w.events) {
      const name = e.activeWindow?.processName
      if (name) apps.add(name)
    }
  }
  return [...apps].sort()
}

/**
 * Stitches fixture frames into one session video for golden review. When
 * `endTimestampMs` is given (the last activity's end), trailing frames past it
 * are dropped and a terminal marker is pinned at the end so the video stops there
 * — otherwise the stitcher holds the final real frame for a full inter-frame
 * interval and the video runs ~1s past the transcript.
 */
async function stitchSessionVideo(
  fixtureDir: string,
  frames: DumpedFrame[],
  endTimestampMs?: number,
): Promise<{ ok: boolean; durationMs?: number; error?: string }> {
  if (frames.length === 0) return { ok: false, error: 'no frames' }

  let clip = frames
  if (endTimestampMs !== undefined) {
    const kept = frames.filter((f) => f.timestamp <= endTimestampMs)
    const last = kept[kept.length - 1]
    // Pin the final hold to the activity end (re-uses the last frame's image).
    clip =
      last && last.timestamp < endTimestampMs
        ? [...kept, { ...last, timestamp: endTimestampMs }]
        : kept
  }
  if (clip.length === 0) return { ok: false, error: 'no frames in range' }

  const outputPath = path.join(fixtureDir, 'session.mp4')
  try {
    const asset = await new FfmpegVideoStitcher().stitch({
      activityId: 'session',
      frames: clip.map((f) => ({
        filepath: path.resolve(fixtureDir, f.filepath),
        timestamp: f.timestamp,
      })),
      outputPath,
    })
    return { ok: true, durationMs: asset.durationMs }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Pre-fills each kept activity's summary from the DB. The session that produced
 * this capture ran the real summarizer and persisted its activities, so those
 * summaries already exist. The producer is deterministic, so a fresh replay cuts
 * activities at the same timestamps the live run did; we match scaffold blocks to
 * DB rows by time overlap and copy the persisted summary in. Mutates `transcript`
 * in place; an unmatched block just leaves a blank. DROPPED blocks were never
 * persisted, so they're skipped. Returns the count of blocks filled.
 */
function fillSummariesFromDb(transcript: ReplayActivity[], storage: StorageService): number {
  const kept = transcript.filter((t) => !t.dropped)
  if (kept.length === 0) return 0

  const sessionStart = Math.min(...kept.map((t) => t.startTimestamp))
  const sessionEnd = Math.max(...kept.map((t) => t.endTimestamp))
  const rows: ActivityDetail[] = storage.activities.getForDay(sessionStart, sessionEnd)

  const used = new Set<string>()
  let filled = 0
  for (const act of kept) {
    let best: ActivityDetail | null = null
    let bestOverlap = 0
    for (const row of rows) {
      if (used.has(row.id)) continue
      const overlap = Math.max(
        0,
        Math.min(act.endTimestamp, row.endTimestamp) -
          Math.max(act.startTimestamp, row.startTimestamp),
      )
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        best = row
      }
    }
    if (best && best.summary.trim()) {
      act.summary = best.summary
      used.add(best.id)
      filled++
    }
  }
  return filled
}

/** Reads the live activities the in-app recorder dumped (summaries captured at
 *  the source). Empty when promoting a CLI `.debug-pipeline` capture, which has
 *  no `activities.jsonl` — that path falls back to the replay scaffold + DB fill. */
function readLiveActivities(sourceDir: string): DumpedActivity[] {
  const filePath = path.join(sourceDir, 'activities.jsonl')
  if (!fs.existsSync(filePath)) return []
  return readJsonl<DumpedActivity>(filePath)
}

/** Adapts a dumped live activity to the `ReplayActivity` shape `renderGoldenMd`
 *  consumes (it reads app/title/times/summary; the rest are inert defaults). */
function liveToReplayActivity(a: DumpedActivity): ReplayActivity {
  return {
    activityId: a.id,
    startTimestamp: a.startTimestamp,
    endTimestamp: a.endTimestamp,
    durationMs: a.endTimestamp - a.startTimestamp,
    appName: a.appName,
    windowTitle: a.windowTitle,
    tld: a.tld,
    interactionCount: 0,
    summary: a.summary,
    summaryModel: a.summaryModel,
    ocrText: '',
    frameRefs: [],
    selectedSnapshotPaths: [],
    diagnostics: null,
  }
}

/** Resolves a storage handle for summary pre-fill: the injected one (not owned),
 *  or one opened from `dbPath` (owned → caller closes via the returned `close`). */
function resolveStorage(opts: PromoteCaptureOptions): {
  storage: StorageService | null
  close: () => void
} {
  if (opts.dbSummaries === false) return { storage: null, close: () => undefined }
  if (opts.storage) return { storage: opts.storage, close: () => undefined }
  if (opts.dbPath && fs.existsSync(opts.dbPath)) {
    const storage = new StorageService(opts.dbPath)
    return { storage, close: () => storage.close() }
  }
  return { storage: null, close: () => undefined }
}

export async function promoteCapture(opts: PromoteCaptureOptions): Promise<PromoteCaptureResult> {
  const windowsSrc = path.join(opts.sourceDir, 'event-windows.jsonl')
  const framesSrc = path.join(opts.sourceDir, 'frames.jsonl')
  for (const f of [windowsSrc, framesSrc]) {
    if (!fs.existsSync(f)) throw new Error(`Not found: ${f}`)
  }

  const windows = readJsonl<EventWindow>(windowsSrc)
  const frames = readJsonl<DumpedFrame>(framesSrc)

  const fixtureDir = path.join(opts.fixturesRoot, opts.name)
  const framesDir = path.join(fixtureDir, 'frames')
  fs.mkdirSync(framesDir, { recursive: true })

  // Copy event windows verbatim (replay-critical input).
  fs.copyFileSync(windowsSrc, path.join(fixtureDir, 'event-windows.jsonl'))

  // Copy referenced PNGs, rewrite paths to relative, drop missing ones.
  const downsample = opts.downsample ?? false
  const promotedFrames: DumpedFrame[] = []
  let missing = 0
  for (const frame of frames) {
    const copied = await copyFrame(frame.filepath, framesDir, downsample)
    if (!copied) {
      missing++
      continue
    }
    promotedFrames.push({ ...frame, filepath: copied.relPath })
  }
  fs.writeFileSync(
    path.join(fixtureDir, 'frames.jsonl'),
    promotedFrames.map((f) => JSON.stringify(f)).join('\n') + '\n',
    'utf8',
  )

  const manifest: FixtureManifest = {
    name: opts.name,
    label: opts.label ?? opts.name,
    description: opts.description ?? '',
    capturedAt: new Date().toISOString(),
    platform: process.platform,
    appMix: deriveAppMix(windows),
    frameCount: promotedFrames.length,
    eventWindowCount: windows.length,
    expectedActivityCount: opts.expectedActivities,
    downsampled: downsample || undefined,
    schemaVersion: FIXTURE_SCHEMA_VERSION,
  }
  fs.writeFileSync(
    path.join(fixtureDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  )

  const result: PromoteCaptureResult = {
    fixtureDir,
    frameCount: promotedFrames.length,
    missingFrames: missing,
    eventWindowCount: windows.length,
    appMix: manifest.appMix,
    downsampled: downsample,
    video: null,
    golden: null,
  }

  const wantVideo = opts.video ?? true
  const wantSeed = opts.seed ?? true
  if (!wantVideo && !wantSeed) return result

  // One no-LLM replay feeds both the review video and the golden transcript, so
  // they share a clock and the video ends exactly where the transcript does.
  const { activities, droppedActivities, sessionStartMs } = await replayFixture({
    fixtureDir,
    transformer: new ScaffoldTransformer(),
  })

  // In-app recordings dump the live pipeline's summaries to `activities.jsonl`;
  // use those as the kept blocks (real capture-time output) instead of the blank
  // replay scaffold. The replay still runs — it's the only source of DROPPED
  // spans (drops are never persisted) and of the session clock. CLI promotions
  // have no `activities.jsonl`, so they keep the replay scaffold + DB fill.
  const liveActivities = readLiveActivities(opts.sourceDir)
  const fromLive = liveActivities.length > 0
  const keptActivities: ReplayActivity[] = fromLive
    ? liveActivities.map(liveToReplayActivity)
    : activities
  const transcript = [...keptActivities, ...droppedActivities]
  const lastBlockEnd = transcript.reduce((max, t) => Math.max(max, t.endTimestamp), 0) || undefined

  if (wantVideo) {
    result.video = await stitchSessionVideo(fixtureDir, promotedFrames, lastBlockEnd)
  }

  if (wantSeed) {
    const goldenPath = path.join(fixtureDir, 'golden.md')
    if (fs.existsSync(goldenPath) && !opts.reseed) {
      result.golden = { seeded: false, kept: 0, dropped: 0, summariesFilled: 0 }
    } else {
      const dropped = transcript.filter((t) => t.dropped).length
      const kept = transcript.length - dropped
      let filled = 0
      if (fromLive) {
        // Summaries are already on the kept blocks; just count the non-empty ones.
        filled = keptActivities.filter((a) => a.summary.trim()).length
      } else {
        const { storage, close } = resolveStorage(opts)
        try {
          if (storage) filled = fillSummariesFromDb(transcript, storage)
        } finally {
          close()
        }
      }
      fs.writeFileSync(
        goldenPath,
        renderGoldenMd(path.basename(fixtureDir), transcript, sessionStartMs),
        'utf8',
      )
      result.golden = { seeded: true, kept, dropped, summariesFilled: filled }
    }
  }

  return result
}
