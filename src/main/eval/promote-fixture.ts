/**
 * Promotes a captured session (the in-app eval recorder's staging dir) into a
 * committed replay fixture. The recorder hands over a directory containing
 * `event-windows.jsonl` + `frames.jsonl` + `activities.jsonl` and gets back a
 * self-contained fixture.
 *
 * The fixture is: event windows copied verbatim (the replay-critical input),
 * referenced PNGs copied in with paths rewritten to relative, a `manifest.json`,
 * an optional `session.mp4` for review, and an optional editable `golden.md`
 * scaffold. Kept-block summaries come straight from the live pipeline's
 * `activities.jsonl` (real capture-time output); a deterministic no-LLM replay
 * supplies only the DROPPED spans + the session clock. No LLM is called here.
 */

import * as fs from 'fs'
import * as path from 'path'
import sharp from 'sharp'
import { SCREEN_CAPTURER_CONFIG } from '../../shared/constants'
import { FfmpegVideoStitcher } from '../video/video-stitcher'
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

/** Reads the live activities the in-app recorder dumped — each carries the
 *  summary the pipeline actually produced at capture time. These become the
 *  golden's kept blocks directly; no replay output or DB lookup is consulted. */
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

  // The no-LLM replay supplies the DROPPED spans (drops are never persisted) and
  // the session clock; kept blocks come from the live recording's summaries.
  const { droppedActivities, sessionStartMs } = await replayFixture({
    fixtureDir,
    transformer: new ScaffoldTransformer(),
  })
  const keptActivities = readLiveActivities(opts.sourceDir).map(liveToReplayActivity)
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
      fs.writeFileSync(
        goldenPath,
        renderGoldenMd(path.basename(fixtureDir), transcript, sessionStartMs),
        'utf8',
      )
      result.golden = {
        seeded: true,
        kept: keptActivities.length,
        dropped: droppedActivities.length,
        summariesFilled: keptActivities.filter((a) => a.summary.trim()).length,
      }
    }
  }

  return result
}
