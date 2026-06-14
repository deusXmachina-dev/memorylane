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
 * (real times + apps, blank summaries) — the file you hand-edit into the target
 * for the eval loop. No LLM: the same producer eval replays, so the scaffold's
 * boundaries match what eval-summaries scores.
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
} from '../src/main/eval/types'
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

  // Full-session review video: playback time ≈ real elapsed time, so the clock
  // lines up with the mm:ss offsets in golden.md.
  if (!a.noVideo) {
    await stitchSessionVideo(fixtureDir, promotedFrames)
  }

  // Seed an editable golden.md from one real replay (draft segmentation +
  // summaries). Skipped offline / when one already exists (unless --reseed).
  if (!a.noSeed) {
    await seedGolden(fixtureDir, a)
  }

  console.log('')
  console.log(
    '  ⚠  Hand-review for private content (window titles, URLs, on-screen text) before committing.',
  )
}

/** Stitches every fixture frame into one session video for golden review. */
async function stitchSessionVideo(fixtureDir: string, frames: DumpedFrame[]): Promise<void> {
  if (frames.length === 0) return
  const outputPath = path.join(fixtureDir, 'session.mp4')
  try {
    const asset = await new FfmpegVideoStitcher().stitch({
      activityId: 'session',
      frames: frames.map((f) => ({
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
 * Writes an editable golden.md scaffold: the producer's real segmentation (times
 * + apps + window titles) with blank summaries to fill in by hand. No LLM — the
 * same producer eval replays, so the scaffold's boundaries match what
 * eval-summaries scores.
 */
async function seedGolden(fixtureDir: string, a: CliArgs): Promise<void> {
  const goldenPath = path.join(fixtureDir, 'golden.md')
  if (fs.existsSync(goldenPath) && !a.reseed) {
    console.log('  Golden:        golden.md exists — not overwriting (use --reseed to regenerate).')
    return
  }

  const { activities } = await replayFixture({
    fixtureDir,
    transformer: new ScaffoldTransformer(),
  })
  fs.writeFileSync(goldenPath, renderGoldenMd(path.basename(fixtureDir), activities), 'utf8')
  console.log(
    `  Golden:        golden.md scaffolded (${activities.length} blocks, no LLM) — write each summary.`,
  )
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
