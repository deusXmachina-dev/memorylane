#!/usr/bin/env npx tsx
/**
 * Replays committed activity-summary fixtures through the REAL pipeline
 * (ActivityProducer -> transformer -> OCR/ffmpeg -> LLM summarizer) and scores
 * every summary with deterministic rule checks (free). When a fixture has a
 * hand-edited `golden.md`, also scores segmentation (do the boundaries match?)
 * and — with `--judge` — per-block LLM equivalence (does each summary mean the
 * same as the target?). Writes a findings-style Markdown scorecard + JSON.
 *
 * Deterministic upstream of the LLM (see replay-harness.ts); only the model and
 * pipeline are variables — everything else runs against code defaults. Reads the
 * app's own settings/credentials (active vendor, API key from env); needs no
 * live app.
 *
 * Benchmarks run in the VIDEO pipeline by default (production's default), each
 * model in isolation (no preset fallback). Pass `--pipeline image` to benchmark
 * snapshot models instead. A/B within one pipeline only: video-vs-video or
 * image-vs-image — a model that can't serve the lane shows as an empty summary.
 *
 * Usage:
 *   npm run eval-summaries                                  (all fixtures, default model, no judge)
 *   npm run eval-summaries -- --fixture vscode-debug
 *   npm run eval-summaries -- --model google/gemini-2.5-flash --judge
 *   npm run eval-summaries -- --judge-model moonshotai/kimi-k3   (implies --judge)
 *   npm run eval-summaries -- --pipeline image              (benchmark snapshot models)
 */

import { config as loadEnv } from 'dotenv'
loadEnv()

import * as fs from 'fs'
import * as path from 'path'
import { VENDOR_PRESETS } from '../src/shared/vendor-defaults'
import type { SemanticPipelinePreference } from '../src/main/semantic/activity-semantic-service'
import { scoreDeterministic } from '../src/main/eval/deterministic'
import { judgeEquivalence } from '../src/main/eval/judge'
import { priceUsd, sumCosts } from '../src/main/eval/cost'
import { renderMarkdown, writeReport } from '../src/main/eval/report'
import { loadGoldenMd, matchSegments, type GoldenActivity } from '../src/main/eval/golden-md'
import type {
  EvalReport,
  FixtureScore,
  GoldenMatch,
  ReplayActivity,
  ScoredSummary,
  SegmentationScore,
} from '../src/main/eval/types'
import { replayCell } from './replay-cell'
import { loadCliInferenceProvider, type CliInferenceProviderHandle } from './cli-inference-provider'

const FIXTURES_ROOT = path.resolve('evals/semantic-summary/fixtures')
const RESULTS_DIR = path.resolve('evals/semantic-summary/results')
const FIXTURE_FILE = 'event-windows.jsonl'
const CONCURRENCY = 4

interface CliArgs {
  fixtures: string[]
  models: string[]
  pipeline: SemanticPipelinePreference
  judge: boolean
  judgeModel: string | null
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  // Video is the production default pipeline, so benchmark there by default.
  const a: CliArgs = { fixtures: [], models: [], pipeline: 'video', judge: false, judgeModel: null }
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
      case '--models':
      case '--model':
        i = take((v) => (a.models = list(v)), i)
        break
      case '--pipeline':
        i = take((v) => {
          if (v === 'auto' || v === 'video' || v === 'image') a.pipeline = v
        }, i)
        break
      case '--judge':
        a.judge = true
        break
      case '--judge-model':
        i = take((v) => {
          a.judgeModel = v
          a.judge = true
        }, i)
        break
    }
  }
  return a
}

function resolveFixtureDir(nameOrPath: string): string {
  const asPath = path.resolve(nameOrPath)
  if (fs.existsSync(path.join(asPath, FIXTURE_FILE))) return asPath
  const asName = path.join(FIXTURES_ROOT, nameOrPath)
  if (fs.existsSync(path.join(asName, FIXTURE_FILE))) return asName
  throw new Error(`Fixture not found: "${nameOrPath}"`)
}

/** Named fixtures, or every fixture in the standard root when none are named. */
function resolveFixtureDirs(a: CliArgs): string[] {
  if (a.fixtures.length) return [...new Set(a.fixtures.map(resolveFixtureDir))]
  const dirs = fs
    .readdirSync(FIXTURES_ROOT)
    .map((entry) => path.join(FIXTURES_ROOT, entry))
    .filter((dir) => fs.existsSync(path.join(dir, FIXTURE_FILE)))
  if (dirs.length === 0) throw new Error(`No fixtures in ${FIXTURES_ROOT}.`)
  return dirs
}

function defaultJudgeModel(handle: CliInferenceProviderHandle): string | null {
  const presets = VENDOR_PRESETS[handle.vendor]
  return handle.patternDetectionModel || presets.patternDetection[0]?.id || null
}

/** Runs `fn` over items with at most `limit` in flight; preserves input order. */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index])
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()),
  )
  return results
}

interface Cell {
  fixtureDir: string
  fixtureName: string
  model: string
}

const mean = (xs: number[]): number => xs.reduce((x, y) => x + y, 0) / xs.length

async function main() {
  const a = parseArgs()
  const fixtureDirs = resolveFixtureDirs(a)
  const handle = loadCliInferenceProvider()
  const presets = VENDOR_PRESETS[handle.vendor]
  const judgeModel = a.judge ? (a.judgeModel ?? defaultJudgeModel(handle)) : null

  // Default model matches the pipeline: the video model for video/auto, the
  // snapshot model for image — so `--model` can be omitted for a quick run.
  const defaultModel =
    a.pipeline === 'image'
      ? (presets.semanticSnapshot[0]?.id ?? handle.semanticSnapshotModel)
      : (presets.semanticVideo[0]?.id ?? handle.semanticVideoModel)
  const models = a.models.length ? a.models : [defaultModel].filter(Boolean)
  if (models.length === 0) throw new Error('No models. Pass --model <id>.')

  const cells: Cell[] = []
  for (const dir of fixtureDirs)
    for (const model of models)
      cells.push({ fixtureDir: dir, fixtureName: path.basename(dir), model })

  console.log(
    `=== Eval ===  vendor=${handle.vendor} cells=${cells.length} judge=${judgeModel ?? 'none'}`,
  )

  const fixtures: FixtureScore[] = await runWithConcurrency(cells, CONCURRENCY, async (cell) => {
    const {
      activities,
      producerStats,
      sessionStartMs: sessionStart,
    } = await replayCell({
      provider: handle.provider,
      vendor: handle.vendor,
      fixtureDir: cell.fixtureDir,
      model: cell.model,
      pipeline: a.pipeline,
    })
    const goldens = loadGoldenMd(path.join(cell.fixtureDir, 'golden.md'))

    const { segmentation, goldenByActivity } = matchAgainstGolden(activities, goldens, sessionStart)
    const summaries = await scoreActivities({
      activities,
      sessionStart,
      judgeModel,
      handle,
      goldenByActivity,
    })

    const eqVals = summaries
      .map((s) => s.golden?.equivalence)
      .filter((n): n is number => typeof n === 'number')

    console.log(
      `  [done] ${cell.fixtureName} | ${cell.model} -> ${activities.length} acts, ` +
        `${summaries.reduce((n, s) => n + s.deterministic.hardFails, 0)} hard-fails` +
        (segmentation ? `, seg ${Math.round(segmentation.coverage * 100)}%` : ''),
    )

    return {
      fixture: cell.fixtureName,
      model: cell.model,
      summaries,
      producerStats,
      detPassRate: summaries.length
        ? Math.round(mean(summaries.map((s) => s.deterministic.passRate)) * 1000) / 1000
        : 0,
      hardFails: summaries.reduce((n, s) => n + s.deterministic.hardFails, 0),
      segmentation,
      avgEquivalence: eqVals.length ? Math.round(mean(eqVals) * 1000) / 1000 : null,
      costUsd: sumCosts(summaries.map((s) => s.summaryCostUsd)),
      judgeCostUsd: sumCosts(summaries.map((s) => s.judgeCostUsd)),
    }
  })

  const report: EvalReport = {
    generatedAt: new Date().toISOString(),
    vendor: handle.vendor,
    judgeModel,
    fixtures,
  }

  // The judge was requested but produced no score anywhere — every call failed,
  // didn't parse, or no activity matched a golden block. Surface it loudly;
  // otherwise the report silently shows "equiv —" and looks like a no-op.
  if (judgeModel && fixtures.every((f) => f.avgEquivalence === null)) {
    console.warn(
      `⚠  Judge "${judgeModel}" returned no equivalence scores — every call failed ` +
        `or nothing matched a golden. Drop --judge to skip the judge.`,
    )
  }

  const { runDir, comparePath } = writeReport(RESULTS_DIR, report)
  console.log('')
  console.log(renderMarkdown(report).split('\n## Summaries')[0])
  console.log(`Wrote ${runDir}/`)
  console.log(`  report.md     full scorecard + per-summary detail`)
  console.log(`  report.json   raw data`)
  if (comparePath) console.log(`  comparison.md ← golden vs models, side by side`)
  else console.log(`  (no comparison.md — needs a golden.md or 2+ models)`)
}

/** Matches replay activities to golden blocks by time overlap (no LLM). */
function matchAgainstGolden(
  activities: ReplayActivity[],
  goldens: GoldenActivity[] | null,
  sessionStart: number,
): {
  segmentation: SegmentationScore | null
  goldenByActivity: Map<string, { golden: GoldenActivity; overlapRatio: number }>
} {
  const goldenByActivity = new Map<string, { golden: GoldenActivity; overlapRatio: number }>()
  if (!goldens || goldens.length === 0) return { segmentation: null, goldenByActivity }

  const report = matchSegments({
    activities: activities.map((act) => ({
      activityId: act.activityId,
      startOffsetMs: act.startTimestamp - sessionStart,
      endOffsetMs: act.endTimestamp - sessionStart,
      windowTitle: act.windowTitle,
    })),
    goldens,
  })
  const byIndex = new Map(goldens.map((g) => [g.index, g]))
  for (const m of report.matches) {
    const g = byIndex.get(m.goldenIndex)
    // Dropped blocks aren't summaries — don't judge equivalence against them.
    // The match is surfaced as a violation in dropViolationIndexes instead.
    if (g && !g.dropped)
      goldenByActivity.set(m.activityId, { golden: g, overlapRatio: m.overlapRatio })
  }

  // Split goldens into "kept" (expect an activity) and "dropped" (expect none).
  // A produced activity matching a DROPPED block is a violation, not coverage.
  const keptGoldens = goldens.filter((g) => !g.dropped)
  const dropGoldens = goldens.filter((g) => g.dropped)
  const matchedIndexes = new Set(report.matches.map((m) => m.goldenIndex))
  const keptMatched = keptGoldens.filter((g) => matchedIndexes.has(g.index)).length
  const dropViolationIndexes = dropGoldens
    .filter((g) => matchedIndexes.has(g.index))
    .map((g) => g.index)

  const segmentation: SegmentationScore = {
    goldenCount: keptGoldens.length,
    coverage:
      keptGoldens.length === 0 ? 1 : Math.round((keptMatched / keptGoldens.length) * 1000) / 1000,
    unmatchedGoldenIndexes: keptGoldens
      .filter((g) => !matchedIndexes.has(g.index))
      .map((g) => g.index),
    extraActivityCount: report.unmatchedActivityIds.length,
    expectedDropCount: dropGoldens.length,
    dropViolationIndexes,
  }
  return { segmentation, goldenByActivity }
}

async function scoreActivities(params: {
  activities: ReplayActivity[]
  sessionStart: number
  judgeModel: string | null
  handle: CliInferenceProviderHandle
  goldenByActivity: Map<string, { golden: GoldenActivity; overlapRatio: number }>
}): Promise<ScoredSummary[]> {
  const { activities, sessionStart, judgeModel, handle, goldenByActivity } = params
  const summaries: ScoredSummary[] = []

  for (const act of activities) {
    const judgeCosts: (number | null)[] = []

    let golden: GoldenMatch | null = null
    const matched = goldenByActivity.get(act.activityId)
    if (matched) {
      let equivalence: number | null = null
      if (judgeModel) {
        const eq = await judgeEquivalence({
          provider: handle.provider,
          model: judgeModel,
          golden: matched.golden.summary,
          candidate: act.summary,
        })
        equivalence = eq?.equivalence ?? null
        if (eq) judgeCosts.push(priceUsd(judgeModel, eq.tokensIn, eq.tokensOut))
      }
      golden = {
        index: matched.golden.index,
        summary: matched.golden.summary,
        overlapRatio: matched.overlapRatio,
        equivalence,
      }
    }

    // Summarizer (production) cost: token usage summed over the model-chain
    // attempts, priced at the model that actually produced the summary.
    const attempts = act.diagnostics?.attempts ?? []
    const summaryTokensIn = attempts.reduce((n, at) => n + (at.promptTokens ?? 0), 0)
    const summaryTokensOut = attempts.reduce((n, at) => n + (at.completionTokens ?? 0), 0)
    const summaryCostUsd =
      summaryTokensIn + summaryTokensOut > 0
        ? priceUsd(act.summaryModel, summaryTokensIn, summaryTokensOut)
        : null

    summaries.push({
      activityId: act.activityId,
      appName: act.appName,
      windowTitle: act.windowTitle,
      startOffsetMs: act.startTimestamp - sessionStart,
      endOffsetMs: act.endTimestamp - sessionStart,
      durationMs: act.durationMs,
      summary: act.summary,
      summaryModel: act.summaryModel,
      ocrText: act.ocrText,
      deterministic: scoreDeterministic(act.summary),
      golden,
      summaryTokensIn,
      summaryTokensOut,
      summaryCostUsd,
      judgeCostUsd: judgeCosts.length ? sumCosts(judgeCosts) : null,
    })
  }
  return summaries
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
