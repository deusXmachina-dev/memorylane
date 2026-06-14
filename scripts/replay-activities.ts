#!/usr/bin/env npx tsx
/**
 * Replays committed activity-summary fixtures through the REAL pipeline
 * (ActivityProducer -> transformer -> OCR/ffmpeg -> LLM summarizer) and writes
 * the resulting activities + summaries to JSON for scoring.
 *
 * Deterministic upstream of the LLM (see replay-harness.ts); only the model,
 * prompt variant, and producer config are variables. Needs no live app — just
 * capture-settings.json / vendor-credentials.json + an API key.
 *
 * Usage:
 *   npm run replay-activities -- --fixture vscode-debugging --out replay.json
 *   npm run replay-activities -- --fixtures a,b --pipeline image --snapshot-model google/gemini-2.5-flash
 *   npm run replay-activities -- --fixtures-dir evals/semantic-summary/fixtures --embeddings stub
 *   npm run replay-activities -- --fixture X --prompt baseline --dump-roundtrips .replay-dump
 */

import { config as loadEnv } from 'dotenv'
loadEnv()

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { VENDOR_PRESETS, buildModelChain } from '../src/shared/vendor-defaults'
import { DefaultActivityTransformer } from '../src/main/activity-transformer'
import { FfmpegVideoStitcher } from '../src/main/video/video-stitcher'
import {
  ActivitySemanticService,
  SemanticFileDebugDumper,
} from '../src/main/activity-semantic-service'
import type { SemanticPipelinePreference } from '../src/main/activity-semantic-service'
import { EmbeddingService } from '../src/main/processor/embedding'
import { activityOcrService } from '../src/main/processor/ocr'
import { replayFixture, StubEmbeddingService } from '../src/main/eval/replay-harness'
import { getPromptVariant } from '../src/main/eval/prompt-registry'
import type { ReplayResult } from '../src/main/eval/types'
import { loadCliInferenceProvider } from './cli-inference-provider'

const FIXTURES_ROOT = path.resolve('evals/semantic-summary/fixtures')

interface CliArgs {
  fixtures: string[]
  fixturesDir: string | null
  pipeline: SemanticPipelinePreference
  videoModelOverride: string | null
  snapshotModelOverride: string | null
  prompt: string
  embeddings: 'stub' | 'real'
  dumpRoundTrips: string | null
  out: string | null
  apiKey: string | undefined
  userDataPath: string | undefined
  vendorOverride: string | undefined
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const a: CliArgs = {
    fixtures: [],
    fixturesDir: null,
    pipeline: 'auto',
    videoModelOverride: null,
    snapshotModelOverride: null,
    prompt: 'baseline',
    embeddings: 'stub',
    dumpRoundTrips: null,
    out: null,
    apiKey: undefined,
    userDataPath: undefined,
    vendorOverride: undefined,
  }

  for (let i = 0; i < args.length; i++) {
    const next = args[i + 1]
    switch (args[i]) {
      case '--fixture':
      case '--fixtures':
        if (next) {
          a.fixtures.push(
            ...next
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          )
          i++
        }
        break
      case '--fixtures-dir':
        if (next) {
          a.fixturesDir = next
          i++
        }
        break
      case '--pipeline':
        if (next === 'auto' || next === 'video' || next === 'image') {
          a.pipeline = next
          i++
        }
        break
      case '--video-model':
        if (next) {
          a.videoModelOverride = next
          i++
        }
        break
      case '--snapshot-model':
        if (next) {
          a.snapshotModelOverride = next
          i++
        }
        break
      case '--prompt':
        if (next) {
          a.prompt = next
          i++
        }
        break
      case '--embeddings':
        if (next === 'stub' || next === 'real') {
          a.embeddings = next
          i++
        }
        break
      case '--dump-roundtrips':
        if (next) {
          a.dumpRoundTrips = next
          i++
        }
        break
      case '--out':
        if (next) {
          a.out = next
          i++
        }
        break
      case '--api-key':
        if (next) {
          a.apiKey = next
          i++
        }
        break
      case '--user-data':
        if (next) {
          a.userDataPath = next
          i++
        }
        break
      case '--vendor':
        if (next) {
          a.vendorOverride = next
          i++
        }
        break
    }
  }
  return a
}

function resolveFixtureDirs(a: CliArgs): string[] {
  const dirs: string[] = []
  for (const f of a.fixtures) {
    const asPath = path.resolve(f)
    const asName = path.join(FIXTURES_ROOT, f)
    if (fs.existsSync(path.join(asPath, 'event-windows.jsonl'))) dirs.push(asPath)
    else if (fs.existsSync(path.join(asName, 'event-windows.jsonl'))) dirs.push(asName)
    else throw new Error(`Fixture not found: "${f}" (looked in ${asPath} and ${asName})`)
  }
  if (a.fixturesDir) {
    const root = path.resolve(a.fixturesDir)
    for (const entry of fs.readdirSync(root)) {
      const dir = path.join(root, entry)
      if (fs.existsSync(path.join(dir, 'event-windows.jsonl'))) dirs.push(dir)
    }
  }
  if (dirs.length === 0) {
    throw new Error(
      'No fixtures specified. Use --fixture <name>, --fixtures a,b, or --fixtures-dir <dir>.',
    )
  }
  return [...new Set(dirs)]
}

async function main() {
  const a = parseArgs()
  const fixtureDirs = resolveFixtureDirs(a)
  const handle = loadCliInferenceProvider({
    apiKey: a.apiKey,
    userDataPath: a.userDataPath,
    vendorOverride: a.vendorOverride,
  })

  const presets = VENDOR_PRESETS[handle.vendor]
  const videoModels = buildModelChain(
    a.videoModelOverride ?? handle.semanticVideoModel,
    presets.semanticVideo,
  )
  const snapshotModels = buildModelChain(
    a.snapshotModelOverride ?? handle.semanticSnapshotModel,
    presets.semanticSnapshot,
  )

  const variant = getPromptVariant(a.prompt)
  const debugDumper = a.dumpRoundTrips
    ? new SemanticFileDebugDumper({
        rootDir: path.resolve(a.dumpRoundTrips),
        cleanRootDir: true,
        copyMediaAssets: true,
      })
    : undefined

  const semanticService = new ActivitySemanticService(handle.provider, {
    videoModels,
    snapshotModels,
    pipelinePreference: a.pipeline,
    debugDumper,
    promptBuilder: variant.build,
    // The default UsageTracker reads Electron's app.getPath, absent under enode.
    usageTracker: { recordUsage: () => {} },
  })

  const embedder = a.embeddings === 'real' ? new EmbeddingService() : new StubEmbeddingService()
  if (embedder instanceof EmbeddingService) await embedder.init()

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memorylane-replay-'))
  const transformer = new DefaultActivityTransformer(
    new FfmpegVideoStitcher(),
    activityOcrService,
    semanticService,
    embedder,
    { outputDir: tmpDir, getPipelinePreference: () => semanticService.getPipelinePreference() },
  )

  console.log('=== Replay Activities ===')
  console.log(`Vendor:   ${handle.vendor}${handle.baseURL ? ` (${handle.baseURL})` : ''}`)
  console.log(`Pipeline: ${a.pipeline}  Prompt: ${variant.id}  Embeddings: ${a.embeddings}`)
  console.log(`Video:    ${videoModels.join(' -> ') || '(none)'}`)
  console.log(`Snapshot: ${snapshotModels.join(' -> ') || '(none)'}`)
  console.log(`Fixtures: ${fixtureDirs.length}`)
  console.log('')

  const results: ReplayResult[] = []
  try {
    for (const fixtureDir of fixtureDirs) {
      const name = path.basename(fixtureDir)
      console.log(`> ${name}`)
      const { activities, producerStats } = await replayFixture({
        fixtureDir,
        transformer,
        getLastDiagnostics: () => semanticService.getLastRunDiagnostics(),
      })
      for (const act of activities) {
        const dur = (act.durationMs / 1000).toFixed(0)
        console.log(`  [${dur}s ${act.appName}] ${act.summary || '(empty)'}`)
      }
      console.log(
        `  ${activities.length} activities; dropped ${producerStats.droppedNoFrameWindows} no-frame, ` +
          `${producerStats.droppedUnknownContextWindows} unknown-context`,
      )
      results.push({
        fixture: name,
        videoModel: videoModels[0] ?? '',
        snapshotModel: snapshotModels[0] ?? '',
        promptVariant: variant.id,
        pipeline: a.pipeline,
        activities,
        producerStats,
        generatedAt: new Date().toISOString(),
      })
    }

    if (a.out) {
      const outPath = path.resolve(a.out)
      fs.mkdirSync(path.dirname(outPath), { recursive: true })
      fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8')
      console.log(`\nWrote ${results.length} replay result(s) to ${outPath}`)
    }
  } finally {
    semanticService.dispose()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
