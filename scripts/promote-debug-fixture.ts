#!/usr/bin/env npx tsx
/**
 * Promotes a debug-pipeline capture into a committed replay fixture.
 *
 * Reads `.debug-pipeline/{event-windows,frames}.jsonl` (written by the debug
 * pipeline when DEBUG_PIPELINE=1), copies the referenced PNGs into the fixture,
 * rewrites frame paths to relative, and synthesizes a manifest. The event-window
 * stream is copied verbatim — it is the replay-critical input.
 *
 * Also (unless disabled): stitches all frames into a `session.mp4` for review,
 * and seeds an editable `golden.md` scaffold from the producer's segmentation
 * (real times + apps). Summaries are pre-filled from the dev DB — the debug
 * session ran the real summarizer and persisted its activities, so those exist
 * already; the producer is deterministic, so the replay's boundaries line up
 * with the persisted rows and we match them by time overlap. You then hand-edit
 * golden.md from a real summary into the target. No LLM is called here.
 *
 * IMPORTANT: hand-review the fixture for private content before committing it.
 * Window titles, URLs, and on-screen text are baked into the events and PNGs.
 *
 * Usage:
 *   npm run promote-debug-fixture -- --name vscode-debugging --label "VS Code debug session"
 *   npm run promote-debug-fixture -- --name X --description "..." --expected-activities 2
 *   npm run promote-debug-fixture -- --name X --downsample            (shrink PNGs -> JPEG)
 *   npm run promote-debug-fixture -- --name X --no-seed --no-video    (skip golden + video)
 *   npm run promote-debug-fixture -- --name X --reseed                (regenerate golden.md scaffold)
 *   npm run promote-debug-fixture -- --name X --no-db-summaries       (blank summaries, skip DB)
 *   npm run promote-debug-fixture -- --name X --db-path /path/to.db   (override the dev DB)
 *   npm run promote-debug-fixture -- --name X --debug-dir /path/to/.debug-pipeline
 */

import * as fs from 'fs'
import * as path from 'path'
import sharp from 'sharp'
import { SCREEN_CAPTURER_CONFIG } from '../src/shared/constants'
import { FfmpegVideoStitcher } from '../src/main/video/video-stitcher'
import { renderGoldenMd } from '../src/main/eval/golden-md'
import { replayFixture, ScaffoldTransformer } from '../src/main/eval/replay-harness'
import { readJsonl } from '../src/main/eval/jsonl'
import {
  FIXTURE_SCHEMA_VERSION,
  type DumpedFrame,
  type FixtureManifest,
  type ReplayActivity,
} from '../src/main/eval/types'
import { StorageService } from '../src/main/storage'
import type { ActivityDetail } from '../src/main/storage/types'
import { getDefaultDbPath } from '../src/main/paths'
import type { EventWindow } from '../src/shared/types'

const FIXTURES_ROOT = path.resolve('evals/semantic-summary/fixtures')

interface CliArgs {
  name: string | null
  label: string | null
  description: string
  debugDir: string
  downsample: boolean
  expectedActivities: number | undefined
  noSeed: boolean
  reseed: boolean
  noVideo: boolean
  noDbSummaries: boolean
  dbPath: string
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const a: CliArgs = {
    name: null,
    label: null,
    description: '',
    debugDir: path.resolve('.debug-pipeline'),
    downsample: false,
    expectedActivities: undefined,
    noSeed: false,
    reseed: false,
    noVideo: false,
    noDbSummaries: false,
    dbPath: getDefaultDbPath(),
  }
  for (let i = 0; i < args.length; i++) {
    const next = args[i + 1]
    switch (args[i]) {
      case '--name':
        if (next) {
          a.name = next
          i++
        }
        break
      case '--label':
        if (next) {
          a.label = next
          i++
        }
        break
      case '--description':
        if (next) {
          a.description = next
          i++
        }
        break
      case '--debug-dir':
        if (next) {
          a.debugDir = path.resolve(next)
          i++
        }
        break
      case '--downsample':
        a.downsample = true
        break
      case '--expected-activities':
        if (next) {
          a.expectedActivities = parseInt(next, 10)
          i++
        }
        break
      case '--no-seed':
        a.noSeed = true
        break
      case '--reseed':
        a.reseed = true
        break
      case '--no-video':
        a.noVideo = true
        break
      case '--no-db-summaries':
        a.noDbSummaries = true
        break
      case '--db-path':
        if (next) {
          a.dbPath = path.resolve(next)
          i++
        }
        break
    }
  }
  return a
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

async function main() {
  const a = parseArgs()
  if (!a.name) {
    console.error(
      'Missing --name. Usage: npm run promote-debug-fixture -- --name <name> [--label ...]',
    )
    process.exit(1)
  }

  const windowsSrc = path.join(a.debugDir, 'event-windows.jsonl')
  const framesSrc = path.join(a.debugDir, 'frames.jsonl')
  for (const f of [windowsSrc, framesSrc]) {
    if (!fs.existsSync(f)) {
      console.error(`Not found: ${f}. Run \`npm run dev:debug-pipeline\`, interact, then promote.`)
      process.exit(1)
    }
  }

  const windows = readJsonl<EventWindow>(windowsSrc)
  const frames = readJsonl<DumpedFrame>(framesSrc)

  const fixtureDir = path.join(FIXTURES_ROOT, a.name)
  const framesDir = path.join(fixtureDir, 'frames')
  fs.mkdirSync(framesDir, { recursive: true })

  // Copy event windows verbatim (replay-critical input).
  fs.copyFileSync(windowsSrc, path.join(fixtureDir, 'event-windows.jsonl'))

  // Copy referenced PNGs, rewrite paths to relative, drop missing ones.
  const promotedFrames: DumpedFrame[] = []
  let missing = 0
  for (const frame of frames) {
    const copied = await copyFrame(frame.filepath, framesDir, a.downsample)
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
    name: a.name,
    label: a.label ?? a.name,
    description: a.description,
    capturedAt: new Date().toISOString(),
    platform: process.platform,
    appMix: deriveAppMix(windows),
    frameCount: promotedFrames.length,
    eventWindowCount: windows.length,
    expectedActivityCount: a.expectedActivities,
    downsampled: a.downsample || undefined,
    schemaVersion: FIXTURE_SCHEMA_VERSION,
  }
  fs.writeFileSync(
    path.join(fixtureDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  )

  console.log(`Promoted fixture "${a.name}" -> ${fixtureDir}`)
  console.log(`  Event windows: ${windows.length}`)
  console.log(
    `  Frames:        ${promotedFrames.length} copied${missing ? `, ${missing} dropped (source PNG already gone)` : ''}`,
  )
  console.log(`  App mix:       ${manifest.appMix.join(', ') || '(none)'}`)
  if (a.downsample)
    console.log('  PNGs downsampled to JPEG (affects OCR/snapshot pixels uniformly).')

  // One no-LLM replay feeds both the review video and the golden transcript, so
  // they share a clock and the video ends exactly where the transcript does.
  if (!a.noVideo || !a.noSeed) {
    const { activities, droppedActivities, sessionStartMs } = await replayFixture({
      fixtureDir,
      transformer: new ScaffoldTransformer(),
    })
    const transcript = [...activities, ...droppedActivities]
    const lastBlockEnd =
      transcript.reduce((max, t) => Math.max(max, t.endTimestamp), 0) || undefined

    // Review video: playback time ≈ elapsed time; trimmed to the last activity so
    // its length matches golden.md instead of trailing past it.
    if (!a.noVideo) {
      await stitchSessionVideo(fixtureDir, promotedFrames, lastBlockEnd)
    }
    // Editable golden.md transcript. Skipped when one exists (unless --reseed).
    if (!a.noSeed) {
      seedGolden(fixtureDir, a, transcript, sessionStartMs)
    }
  }

  console.log('')
  console.log(
    '  ⚠  Hand-review for private content (window titles, URLs, on-screen text) before committing.',
  )
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
): Promise<void> {
  if (frames.length === 0) return

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
  if (clip.length === 0) return

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
    console.log(`  Video:         session.mp4 (${(asset.durationMs / 1000).toFixed(0)}s)`)
  } catch (error) {
    console.warn(
      `  Video:         skipped (ffmpeg failed: ${error instanceof Error ? error.message : String(error)})`,
    )
  }
}

/**
 * Pre-fills each kept activity's summary from the dev DB. The debug session that
 * produced this capture ran the real summarizer and persisted its activities, so
 * those summaries already exist. The producer is deterministic, so a fresh replay
 * cuts activities at the same timestamps the live run did; we match scaffold
 * blocks to DB rows by time overlap and copy the persisted summary in — you edit
 * golden.md from a real summary instead of a blank line.
 *
 * Best-effort and mutates `transcript` in place: a missing DB or an unmatched
 * block just leaves a blank (the original scaffold behavior). Returns the count
 * of blocks filled. DROPPED blocks were never persisted, so they're skipped.
 */
function fillSummariesFromDb(transcript: ReplayActivity[], dbPath: string): number {
  if (!fs.existsSync(dbPath)) {
    console.log(`  Golden:        no DB at ${dbPath} — summaries left blank.`)
    return 0
  }

  const kept = transcript.filter((t) => !t.dropped)
  if (kept.length === 0) return 0

  const sessionStart = Math.min(...kept.map((t) => t.startTimestamp))
  const sessionEnd = Math.max(...kept.map((t) => t.endTimestamp))

  const storage = new StorageService(dbPath)
  let rows: ActivityDetail[]
  try {
    rows = storage.activities.getForDay(sessionStart, sessionEnd)
  } finally {
    storage.close()
  }

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

/**
 * Writes an editable golden.md scaffold from the producer transcript (emitted
 * activities + DROPPED blocks for everything discarded), on the session.mp4 clock
 * so mm:ss lines up with the review video. Summaries are pre-filled from the dev
 * DB (unless --no-db-summaries); no LLM is called.
 */
function seedGolden(
  fixtureDir: string,
  a: CliArgs,
  transcript: ReplayActivity[],
  sessionStartMs: number,
): void {
  const goldenPath = path.join(fixtureDir, 'golden.md')
  if (fs.existsSync(goldenPath) && !a.reseed) {
    console.log('  Golden:        golden.md exists — not overwriting (use --reseed to regenerate).')
    return
  }

  const dropped = transcript.filter((t) => t.dropped).length
  const kept = transcript.length - dropped
  const filled = a.noDbSummaries ? 0 : fillSummariesFromDb(transcript, a.dbPath)

  fs.writeFileSync(
    goldenPath,
    renderGoldenMd(path.basename(fixtureDir), transcript, sessionStartMs),
    'utf8',
  )
  const summarySrc = a.noDbSummaries ? 'no summaries' : `${filled}/${kept} summaries from DB`
  console.log(
    `  Golden:        golden.md scaffolded (${kept} kept + ${dropped} dropped, ${summarySrc}) — review each summary.`,
  )
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
