#!/usr/bin/env npx tsx
/**
 * Runs the activity-summary eval matrix (fixtures × models × prompts): replays
 * each cell through the real pipeline, scores every summary with deterministic
 * checks + an LLM-judge rubric + optional goldens, and writes a findings-style
 * scorecard with an optional baseline diff.
 *
 * Usage:
 *   npm run eval-summaries -- --fixtures vscode-debugging --models google/gemini-2.5-flash --prompts baseline
 *   npm run eval-summaries -- --fixtures a,b --models m1,m2 --prompts baseline,tweaked --baseline latest
 *   npm run eval-summaries -- --fixtures X --no-llm-judge          (deterministic only, free)
 *   npm run eval-summaries -- --replay-json replay.json --judge-model google/gemini-2.5-pro
 *   npm run eval-summaries -- --mark-baseline latest               (set baseline pointer, no run)
 */

import { config as loadEnv } from 'dotenv'
loadEnv()

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as crypto from 'crypto'
import { VENDOR_PRESETS, buildModelChain } from '../src/shared/vendor-defaults'
import { DefaultActivityTransformer } from '../src/main/activity-transformer'
import { FfmpegVideoStitcher } from '../src/main/video/video-stitcher'
import { ActivitySemanticService } from '../src/main/activity-semantic-service'
import type { SemanticPipelinePreference } from '../src/main/activity-semantic-service'
import { EmbeddingService } from '../src/main/processor/embedding'
import { activityOcrService } from '../src/main/processor/ocr'
import { replayFixture, StubEmbeddingService } from '../src/main/eval/replay-harness'
import { getPromptVariant } from '../src/main/eval/prompt-registry'
import { judgeSummary } from '../src/main/eval/rubric'
import {
  matchGoldens,
  combineGoldenScore,
  judgeGoldenEquivalence,
  embedSimilarity,
} from '../src/main/eval/golden'
import {
  buildScoredSummary,
  aggregateCell,
  computeCellCost,
  runWithConcurrency,
} from '../src/main/eval/matrix-runner'
import {
  renderMarkdown,
  writeRun,
  readRun,
  readBaselinePointer,
  writeBaselinePointer,
  latestRunId,
} from '../src/main/eval/report'
import type {
  CellResult,
  EvalRun,
  GoldenEntry,
  GoldenReport,
  ReplayResult,
  RubricScore,
  ScoredSummary,
} from '../src/main/eval/types'
import { loadCliInferenceProvider, type CliInferenceProviderHandle } from './cli-inference-provider'

const FIXTURES_ROOT = path.resolve('evals/semantic-summary/fixtures')
const DEFAULT_RESULTS_DIR = path.resolve('evals/semantic-summary/results')

interface CliArgs {
  fixtures: string[]
  fixturesDir: string | null
  models: string[]
  prompts: string[]
  pipeline: SemanticPipelinePreference
  judgeModel: string | null
  judgeTextOnly: boolean
  noLlmJudge: boolean
  judgeSamples: number
  concurrency: number
  replayJson: string | null
  noCache: boolean
  baseline: string | null
  markBaseline: string | null
  out: string
  apiKey: string | undefined
  userDataPath: string | undefined
  vendorOverride: string | undefined
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const a: CliArgs = {
    fixtures: [],
    fixturesDir: null,
    models: [],
    prompts: ['baseline'],
    pipeline: 'auto',
    judgeModel: null,
    judgeTextOnly: false,
    noLlmJudge: false,
    judgeSamples: 1,
    concurrency: 4,
    replayJson: null,
    noCache: false,
    baseline: null,
    markBaseline: null,
    out: DEFAULT_RESULTS_DIR,
    apiKey: undefined,
    userDataPath: undefined,
    vendorOverride: undefined,
  }
  const list = (s: string): string[] =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  const take = (fn: (v: string) => void, i: number): number => {
    const v = args[i + 1]
    if (v !== undefined) {
      fn(v)
      return i + 1
    }
    return i
  }
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--fixture':
      case '--fixtures':
        i = take((v) => a.fixtures.push(...list(v)), i)
        break
      case '--fixtures-dir':
        i = take((v) => (a.fixturesDir = v), i)
        break
      case '--models':
        i = take((v) => (a.models = list(v)), i)
        break
      case '--prompts':
        i = take((v) => (a.prompts = list(v)), i)
        break
      case '--pipeline':
        i = take((v) => {
          if (v === 'auto' || v === 'video' || v === 'image') a.pipeline = v
        }, i)
        break
      case '--judge-model':
        i = take((v) => (a.judgeModel = v), i)
        break
      case '--judge-text-only':
        a.judgeTextOnly = true
        break
      case '--no-llm-judge':
        a.noLlmJudge = true
        break
      case '--judge-samples':
        i = take((v) => (a.judgeSamples = Math.max(1, parseInt(v, 10))), i)
        break
      case '--concurrency':
        i = take((v) => (a.concurrency = Math.max(1, parseInt(v, 10))), i)
        break
      case '--replay-json':
        i = take((v) => (a.replayJson = v), i)
        break
      case '--no-cache':
        a.noCache = true
        break
      case '--baseline':
        i = take((v) => (a.baseline = v), i)
        break
      case '--mark-baseline':
        i = take((v) => (a.markBaseline = v), i)
        break
      case '--out':
        i = take((v) => (a.out = path.resolve(v)), i)
        break
      case '--api-key':
        i = take((v) => (a.apiKey = v), i)
        break
      case '--user-data':
        i = take((v) => (a.userDataPath = v), i)
        break
      case '--vendor':
        i = take((v) => (a.vendorOverride = v), i)
        break
    }
  }
  return a
}

function resolveFixtureDir(nameOrPath: string): string {
  const asPath = path.resolve(nameOrPath)
  if (fs.existsSync(path.join(asPath, 'event-windows.jsonl'))) return asPath
  const asName = path.join(FIXTURES_ROOT, nameOrPath)
  if (fs.existsSync(path.join(asName, 'event-windows.jsonl'))) return asName
  throw new Error(`Fixture not found: "${nameOrPath}"`)
}

function readJsonl<T>(filePath: string): T[] {
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T)
}

function sessionStartFor(fixtureDir: string): number {
  const windows = readJsonl<{ startTimestamp: number }>(
    path.join(fixtureDir, 'event-windows.jsonl'),
  )
  return windows.reduce((min, w) => Math.min(min, w.startTimestamp), Number.POSITIVE_INFINITY)
}

function loadGoldens(fixtureDir: string): GoldenEntry[] {
  const p = path.join(fixtureDir, 'goldens.json')
  if (!fs.existsSync(p)) return []
  return JSON.parse(fs.readFileSync(p, 'utf8')) as GoldenEntry[]
}

function fixtureContentHash(fixtureDir: string): string {
  const h = crypto.createHash('sha256')
  for (const f of ['event-windows.jsonl', 'frames.jsonl']) {
    h.update(fs.readFileSync(path.join(fixtureDir, f)))
  }
  return h.digest('hex').slice(0, 16)
}

function defaultJudgeModel(handle: CliInferenceProviderHandle): string | null {
  const presets = VENDOR_PRESETS[handle.vendor]
  return handle.patternDetectionModel || presets.patternDetection[0]?.id || null
}

interface CellSpec {
  fixtureDir: string
  fixtureName: string
  model: string
  prompt: string
}

async function main() {
  const a = parseArgs()
  const resultsDir = a.out

  // Pure baseline-pointer update, no run.
  if (a.markBaseline && !a.fixtures.length && !a.fixturesDir && !a.replayJson) {
    const id = a.markBaseline === 'latest' ? latestRunId(resultsDir) : a.markBaseline
    if (!id) throw new Error('No run to mark as baseline.')
    writeBaselinePointer(resultsDir, id)
    console.log(`Baseline pointer -> ${id}`)
    return
  }

  const handle = loadCliInferenceProvider({
    apiKey: a.apiKey,
    userDataPath: a.userDataPath,
    vendorOverride: a.vendorOverride,
  })
  const presets = VENDOR_PRESETS[handle.vendor]
  const judgeModel = a.noLlmJudge ? null : (a.judgeModel ?? defaultJudgeModel(handle))

  // ---- Phase 1: obtain ReplayResult per cell (run or load) ----
  let replayResults: ReplayResult[]
  const fixtureDirByName = new Map<string, string>()

  if (a.replayJson) {
    replayResults = JSON.parse(
      fs.readFileSync(path.resolve(a.replayJson), 'utf8'),
    ) as ReplayResult[]
    for (const r of replayResults) fixtureDirByName.set(r.fixture, resolveFixtureDir(r.fixture))
  } else {
    const fixtureDirs = [
      ...a.fixtures.map(resolveFixtureDir),
      ...(a.fixturesDir
        ? fs
            .readdirSync(path.resolve(a.fixturesDir))
            .map((e) => path.join(path.resolve(a.fixturesDir), e))
            .filter((d) => fs.existsSync(path.join(d, 'event-windows.jsonl')))
        : []),
    ]
    if (fixtureDirs.length === 0) throw new Error('No fixtures. Use --fixtures or --fixtures-dir.')

    const models = a.models.length
      ? a.models
      : [presets.semanticSnapshot[0]?.id ?? handle.semanticSnapshotModel].filter(Boolean)
    if (models.length === 0) throw new Error('No models. Pass --models <id,...>.')

    const specs: CellSpec[] = []
    for (const dir of fixtureDirs) {
      const name = path.basename(dir)
      fixtureDirByName.set(name, dir)
      for (const model of models)
        for (const prompt of a.prompts) {
          specs.push({ fixtureDir: dir, fixtureName: name, model, prompt })
        }
    }

    const cacheDir = path.join(resultsDir, '.cache')
    console.log(
      `=== Eval (replay) ===  vendor=${handle.vendor} cells=${specs.length} judge=${judgeModel ?? 'none'}`,
    )

    replayResults = await runWithConcurrency(specs, a.concurrency, async (spec) => {
      const variant = getPromptVariant(spec.prompt)
      const cacheKey = crypto
        .createHash('sha256')
        .update(
          `${fixtureContentHash(spec.fixtureDir)}|${spec.model}|${variant.id}|${a.pipeline}|${hashStr(variant.rules)}`,
        )
        .digest('hex')
        .slice(0, 24)
      const cachePath = path.join(cacheDir, `${cacheKey}.json`)
      if (!a.noCache && fs.existsSync(cachePath)) {
        console.log(`  [cache] ${spec.fixtureName} | ${spec.model} | ${variant.id}`)
        return JSON.parse(fs.readFileSync(cachePath, 'utf8')) as ReplayResult
      }

      const videoModels =
        a.pipeline === 'image' ? [] : buildModelChain(spec.model, presets.semanticVideo)
      const snapshotModels = buildModelChain(spec.model, presets.semanticSnapshot)
      const semantic = new ActivitySemanticService(handle.provider, {
        videoModels,
        snapshotModels,
        pipelinePreference: a.pipeline,
        promptBuilder: variant.build,
        // The default UsageTracker reads Electron's app.getPath, which is absent
        // under enode; the eval tracks tokens itself from diagnostics.
        usageTracker: { recordUsage: () => {} },
      })
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memorylane-eval-'))
      const transformer = new DefaultActivityTransformer(
        new FfmpegVideoStitcher(),
        activityOcrService,
        semantic,
        new StubEmbeddingService(),
        { outputDir: tmpDir, getPipelinePreference: () => semantic.getPipelinePreference() },
      )
      try {
        const { activities, producerStats } = await replayFixture({
          fixtureDir: spec.fixtureDir,
          transformer,
          getLastDiagnostics: () => semantic.getLastRunDiagnostics(),
        })
        const result: ReplayResult = {
          fixture: spec.fixtureName,
          videoModel: videoModels[0] ?? '',
          snapshotModel: snapshotModels[0] ?? '',
          promptVariant: variant.id,
          pipeline: a.pipeline,
          activities,
          producerStats,
          generatedAt: new Date().toISOString(),
        }
        if (!a.noCache) {
          fs.mkdirSync(cacheDir, { recursive: true })
          fs.writeFileSync(cachePath, JSON.stringify(result), 'utf8')
        }
        console.log(
          `  [done] ${spec.fixtureName} | ${spec.model} | ${variant.id} -> ${activities.length} acts`,
        )
        return result
      } finally {
        semantic.dispose()
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  }

  // ---- Phase 2: score each cell ----
  const goldenEmbedder = new EmbeddingNeededLazy()
  const cells: CellResult[] = await runWithConcurrency(
    replayResults,
    a.concurrency,
    async (replay) => {
      const fixtureDir = fixtureDirByName.get(replay.fixture)!
      const sessionStart = sessionStartFor(fixtureDir)
      const goldens = loadGoldens(fixtureDir)
      const variant = getPromptVariant(replay.promptVariant)

      let judgeTokensIn = 0
      let judgeTokensOut = 0

      // Golden matching first (so each summary knows its goldenId).
      let goldenReport: GoldenReport | null = null
      if (goldens.length) {
        goldenReport = matchGoldens({
          activities: replay.activities.map((act) => ({
            activityId: act.activityId,
            startTimestamp: act.startTimestamp,
            endTimestamp: act.endTimestamp,
            windowTitle: act.windowTitle,
            tld: act.tld,
          })),
          goldens,
          sessionStartTimestamp: sessionStart,
        })
      }
      const goldenIdByActivity = new Map<string, string>(
        (goldenReport?.matches ?? []).map((m) => [m.activityId!, m.goldenId]),
      )

      const summaries: ScoredSummary[] = []
      for (const act of replay.activities) {
        let rubric: RubricScore | null = null
        if (judgeModel) {
          rubric = await judgeSummary({
            provider: handle.provider,
            judgeModel,
            summary: act.summary,
            ocrText: act.ocrText,
            rules: variant.rules,
            metadata: {
              appName: act.appName,
              windowTitle: act.windowTitle,
              tld: act.tld,
              durationMs: act.durationMs,
            },
            imagePaths: act.selectedSnapshotPaths.length
              ? act.selectedSnapshotPaths
              : act.frameRefs,
            textOnly: a.judgeTextOnly,
            samples: a.judgeSamples,
          })
          if (rubric) {
            judgeTokensIn += rubric.tokensIn
            judgeTokensOut += rubric.tokensOut
          }
        }
        summaries.push(
          buildScoredSummary({
            activity: act,
            sessionStartTimestamp: sessionStart,
            rubric,
            goldenId: goldenIdByActivity.get(act.activityId) ?? null,
          }),
        )
      }

      // Golden scoring: embedSim (real embeddings) + judge equivalence.
      if (goldenReport && goldenReport.matches.length) {
        const goldenById = new Map(goldens.map((g) => [g.id, g]))
        const summaryById = new Map(summaries.map((s) => [s.activityId, s]))
        for (const m of goldenReport.matches) {
          const g = goldenById.get(m.goldenId)
          const s = m.activityId ? summaryById.get(m.activityId) : undefined
          if (!g || !s) continue
          let embedSim: number | null = null
          try {
            const embedder = await goldenEmbedder.get()
            embedSim = embedSimilarity(
              await embedder.embed(g.summary),
              await embedder.embed(s.summary),
            )
          } catch {
            embedSim = null
          }
          let equivalence: number | null = null
          if (judgeModel) {
            const eq = await judgeGoldenEquivalence({
              provider: handle.provider,
              model: judgeModel,
              golden: g.summary,
              candidate: s.summary,
            })
            if (eq) {
              equivalence = eq.equivalence
              judgeTokensIn += eq.tokensIn
              judgeTokensOut += eq.tokensOut
            }
          }
          m.embedSim = embedSim
          m.judgeEquivalence = equivalence
          m.score = combineGoldenScore(embedSim, equivalence)
        }
      }

      const cost = computeCellCost({
        activities: replay.activities,
        judgeModel,
        judgeTokensIn,
        judgeTokensOut,
      })

      return {
        fixture: replay.fixture,
        videoModel: replay.videoModel,
        snapshotModel: replay.snapshotModel,
        promptVariant: replay.promptVariant,
        pipeline: replay.pipeline,
        summaries,
        golden: goldenReport,
        cost,
        aggregate: aggregateCell(summaries, goldenReport),
        producerStats: replay.producerStats,
      }
    },
  )

  // ---- Phase 3: assemble + write ----
  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const run: EvalRun = {
    runId,
    generatedAt: new Date().toISOString(),
    vendor: handle.vendor,
    judgeModel,
    judgeTextOnly: a.judgeTextOnly,
    cells,
    baselineRunId: null,
  }

  let baseline: EvalRun | null = null
  const baselineId =
    a.baseline === 'latest'
      ? (readBaselinePointer(resultsDir) ?? latestRunId(resultsDir))
      : a.baseline
  if (baselineId) {
    baseline = readRun(resultsDir, baselineId)
    run.baselineRunId = baseline ? baselineId : null
    if (!baseline) console.warn(`(baseline run ${baselineId} not found; skipping diff)`)
  }

  const { jsonPath, mdPath } = writeRun(resultsDir, run)
  fs.writeFileSync(mdPath, renderMarkdown(run, baseline), 'utf8')

  if (a.markBaseline) {
    const id = a.markBaseline === 'latest' ? runId : a.markBaseline
    writeBaselinePointer(resultsDir, id)
    console.log(`Baseline pointer -> ${id}`)
  }

  console.log('')
  console.log(`Wrote ${jsonPath}`)
  console.log(`Wrote ${mdPath}`)
  for (const c of cells) {
    console.log(
      `  ${c.fixture} | ${c.videoModel || '-'}/${c.snapshotModel || '-'} | ${c.promptVariant}: ` +
        `rubric ${c.aggregate.avgRubric10 ?? '—'}, det ${(c.aggregate.detPassRate * 100).toFixed(0)}%, ` +
        `${c.aggregate.hardFails} hard-fails, $${c.cost.usd.toFixed(4)}`,
    )
  }
}

function hashStr(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 12)
}

/** Lazily loads the MiniLM embedder only when goldens actually need embedSim. */
class EmbeddingNeededLazy {
  private svc: EmbeddingService | null = null
  private initPromise: Promise<EmbeddingService> | null = null
  async get(): Promise<EmbeddingService> {
    if (this.svc) return this.svc
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const s = new EmbeddingService()
        await s.init()
        this.svc = s
        return s
      })()
    }
    return this.initPromise
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
