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
 * This is a thin wrapper over `promoteCapture()` (src/main/eval/promote-fixture.ts),
 * the same logic the in-app eval recorder uses.
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

import * as path from 'path'
import { promoteCapture } from '../src/main/eval/promote-fixture'
import { getDefaultDbPath } from '../src/main/paths'

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

async function main() {
  const a = parseArgs()
  if (!a.name) {
    console.error(
      'Missing --name. Usage: npm run promote-debug-fixture -- --name <name> [--label ...]',
    )
    process.exit(1)
  }

  let result
  try {
    result = await promoteCapture({
      sourceDir: a.debugDir,
      fixturesRoot: FIXTURES_ROOT,
      name: a.name,
      label: a.label ?? undefined,
      description: a.description,
      downsample: a.downsample,
      video: !a.noVideo,
      seed: !a.noSeed,
      reseed: a.reseed,
      expectedActivities: a.expectedActivities,
      dbSummaries: !a.noDbSummaries,
      dbPath: a.dbPath,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`${message}. Run \`npm run dev:debug-pipeline\`, interact, then promote.`)
    process.exit(1)
  }

  console.log(`Promoted fixture "${a.name}" -> ${result.fixtureDir}`)
  console.log(`  Event windows: ${result.eventWindowCount}`)
  console.log(
    `  Frames:        ${result.frameCount} copied${result.missingFrames ? `, ${result.missingFrames} dropped (source PNG already gone)` : ''}`,
  )
  console.log(`  App mix:       ${result.appMix.join(', ') || '(none)'}`)
  if (result.downsampled)
    console.log('  PNGs downsampled to JPEG (affects OCR/snapshot pixels uniformly).')

  if (result.video) {
    if (result.video.ok) {
      console.log(
        `  Video:         session.mp4 (${((result.video.durationMs ?? 0) / 1000).toFixed(0)}s)`,
      )
    } else {
      console.warn(`  Video:         skipped (ffmpeg failed: ${result.video.error})`)
    }
  }

  if (result.golden) {
    if (!result.golden.seeded) {
      console.log(
        '  Golden:        golden.md exists — not overwriting (use --reseed to regenerate).',
      )
    } else {
      const summarySrc = a.noDbSummaries
        ? 'no summaries'
        : `${result.golden.summariesFilled}/${result.golden.kept} summaries from DB`
      console.log(
        `  Golden:        golden.md scaffolded (${result.golden.kept} kept + ${result.golden.dropped} dropped, ${summarySrc}) — review each summary.`,
      )
    }
  }

  console.log('')
  console.log(
    '  ⚠  Hand-review for private content (window titles, URLs, on-screen text) before committing.',
  )
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
