#!/usr/bin/env npx tsx
/**
 * Seeds committed task-mining fixtures into a temp DB, runs the REAL miner over
 * each whole day, and scores it against the day's golden tasks: recall (found
 * every golden task?), misses, false positives (sightings matching no golden
 * task), and grounding (right activities referenced), plus an optional LLM judge
 * (semantic equivalence). Writes a findings-style Markdown scorecard + JSON.
 *
 * Each fixture is a whole real day exported from the dev DB (realistic volume),
 * with a hand-authored golden.md listing its useful tasks; see
 * evals/task-mining/README.md. Needs no live app — just capture-settings.json /
 * vendor-credentials.json + an API key.
 *
 * Usage:
 *   npm run eval-tasks -- --fixtures 2026-06-10 --label   (append found sightings to golden.md to thumbs)
 *   npm run eval-tasks -- --fixtures 2026-06-10           (score against your keep/reject labels)
 *   npm run eval-tasks -- --fixtures a,b --models m1,m2 --judge-model X
 *   npm run eval-tasks -- --fixtures X --no-llm-judge     (deterministic only, free)
 *   npm run eval-tasks -- --fixtures-dir evals/task-mining/fixtures
 */

import { config as loadEnv } from 'dotenv'
loadEnv()

import * as fs from 'fs'
import * as path from 'path'
import { EmbeddingService } from '../src/main/processor/embedding'
import { PATTERN_DETECTION_CONFIG } from '../src/shared/constants'
import { loadTaskFixture, runTaskFixture } from '../src/main/eval/task-replay'
import { scoreTaskFixture, bestDetectedForGolden } from '../src/main/eval/task-score'
import { renderLabelBlocks } from '../src/main/eval/task-golden-md'
import { judgeSighting } from '../src/main/eval/task-judge'
import { priceUsd } from '../src/main/eval/cost'
import type {
  NewSighting,
  TaskEvalReport,
  TaskFixtureScore,
  TaskJudgeScore,
} from '../src/main/eval/task-types'
import { loadCliInferenceProvider } from './cli-inference-provider'

const FIXTURES_ROOT = path.resolve('evals/task-mining/fixtures')
const DEFAULT_RESULTS_DIR = path.resolve('evals/task-mining/results')

interface CliArgs {
  fixtures: string[]
  fixturesDir: string | null
  models: string[]
  lookback: number
  judgeModel: string | null
  noLlmJudge: boolean
  label: boolean
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
    lookback: PATTERN_DETECTION_CONFIG.LOOKBACK_DAYS,
    judgeModel: null,
    noLlmJudge: false,
    label: false,
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
      case '--model':
        i = take((v) => (a.models = list(v)), i)
        break
      case '--lookback':
        i = take((v) => (a.lookback = parseInt(v, 10)), i)
        break
      case '--judge-model':
        i = take((v) => (a.judgeModel = v), i)
        break
      case '--no-llm-judge':
        a.noLlmJudge = true
        break
      case '--label':
        a.label = true
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

function resolveFixtureDirs(a: CliArgs): string[] {
  if (a.fixturesDir) {
    const root = path.resolve(a.fixturesDir)
    return fs
      .readdirSync(root)
      .map((name) => path.join(root, name))
      .filter((p) => fs.existsSync(path.join(p, 'manifest.json')))
  }
  return a.fixtures.map((name) => path.join(FIXTURES_ROOT, name))
}

// ---------------------------------------------------------------------------
// Report rendering (findings-style, mirrors src/main/eval/report.ts)
// ---------------------------------------------------------------------------

const pct = (x: number | null): string => (x == null ? '—' : `${Math.round(x * 100)}%`)
const num = (x: number | null, d = 2): string => (x == null ? '—' : x.toFixed(d))
const usd = (x: number | null): string => (x == null ? '—' : `$${x.toFixed(4)}`)

function renderMarkdown(report: TaskEvalReport): string {
  const lines: string[] = []
  lines.push(`# Task-Mining Eval — ${report.generatedAt}`)
  lines.push('')
  lines.push(`- Vendor: ${report.vendor}`)
  lines.push(`- Judge: ${report.judgeModel ?? '(none)'}`)
  lines.push('')
  lines.push('## Scorecard')
  lines.push('')
  lines.push(
    '| Fixture | Model | Found (keep) | Recall | Reject reproduced | New | Grounding | Equiv | Cost |',
  )
  lines.push('|---|---|--:|--:|--:|--:|--:|--:|--:|')
  for (const f of report.fixtures) {
    lines.push(
      `| ${f.fixture} | ${f.model} | ${f.foundCount}/${f.positiveCount} | ${pct(f.recall)} | ` +
        `${f.rejectedReproducedCount}/${f.negativeCount} | ${f.newCount} | ` +
        `${pct(f.avgGroundingRecall)} | ${num(f.avgEquivalence)} | ${usd(f.costUsd)} |`,
    )
  }
  lines.push('')
  lines.push('## Detail')
  for (const f of report.fixtures) {
    lines.push('')
    lines.push(`### ${f.fixture} | ${f.model}`)
    lines.push(
      `> ${f.detectedCount} sighting(s) detected; ${f.foundCount}/${f.positiveCount} keep tasks found; ` +
        `${f.rejectedReproducedCount} reject(s) reproduced; ${f.newCount} new`,
    )
    if (f.rejectedReproducedTitles.length)
      lines.push(`> ⚠ reproduced rejects: ${f.rejectedReproducedTitles.join('; ')}`)
    if (f.bundledSightingIds.length)
      lines.push(`> ⚠ ${f.bundledSightingIds.length} sighting(s) bundled multiple keep tasks`)
    for (const g of f.goldenScores) {
      const mark = g.found ? '✅' : '❌'
      lines.push('')
      lines.push(`- ${mark} **${g.goldenTitle}** → ${g.matchedTitle ?? '(missed)'}`)
      lines.push(
        `  - grounding: recall ${pct(g.grounding.recall)}, precision ${pct(g.grounding.precision)}, ` +
          `IoU ${pct(g.grounding.iou)} (${g.grounding.matchedIds.length} ids)`,
      )
      if (g.equivalence != null) {
        lines.push(`  - judge: equiv ${num(g.equivalence)}`)
      }
    }
    if (f.newSightings.length) {
      lines.push('')
      lines.push('New (unlabeled — thumbs these with `--label`):')
      for (const n of f.newSightings) lines.push(`  - ${n.title} (${n.activityIds.length} ids)`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const a = parseArgs()
  const dirs = resolveFixtureDirs(a)
  if (dirs.length === 0) {
    console.error('No fixtures. Pass --fixtures <name,...> or --fixtures-dir <dir>.')
    process.exit(1)
  }

  const handle = loadCliInferenceProvider({
    apiKey: a.apiKey,
    userDataPath: a.userDataPath,
    vendorOverride: a.vendorOverride,
  })
  const models =
    a.models.length > 0
      ? a.models
      : [handle.patternDetectionModel || PATTERN_DETECTION_CONFIG.MODEL]
  const judgeModel = a.judgeModel ?? models[0]

  console.log('=== Task-Mining Eval ===')
  console.log(`Vendor:   ${handle.vendor}${handle.baseURL ? ` (${handle.baseURL})` : ''}`)
  console.log(`Models:   ${models.join(', ')}`)
  console.log(`Judge:    ${a.noLlmJudge ? '(disabled)' : judgeModel}`)
  console.log(`Lookback: ${a.lookback}d`)
  console.log(`Fixtures: ${dirs.map((d) => path.basename(d)).join(', ')}`)
  console.log('')

  const embedder = new EmbeddingService()
  await embedder.init()

  const scores: TaskFixtureScore[] = []

  for (const dir of dirs) {
    const fixture = loadTaskFixture(dir)
    const positiveCount = fixture.golden.sightings.filter((s) => s.verdict === 'keep').length
    if (positiveCount === 0 && !a.label) {
      console.warn(
        `  ⚠ ${fixture.manifest.name}: no keep-labeled tasks in golden.md. ` +
          `Run with --label to populate candidates, then thumbs them. Skipping scoring.`,
      )
      continue
    }
    // Collect new (unlabeled) sightings across models for --label, deduped by id-set.
    const newByKey = new Map<string, NewSighting>()
    for (const model of models) {
      console.log(`\n--- ${fixture.manifest.name} × ${model} ---`)
      const run = await runTaskFixture({
        provider: handle.provider,
        fixture,
        model,
        lookbackDays: a.lookback,
        embedder,
        onProgress: (msg) => console.log(`  ${msg}`),
      })

      const judge = new Map<string, TaskJudgeScore>()
      let judgeTokensIn = 0
      let judgeTokensOut = 0
      if (!a.noLlmJudge) {
        for (const g of fixture.golden.sightings) {
          if (g.verdict !== 'keep') continue
          const best = bestDetectedForGolden(g.activityIds, run.detected)
          if (!best) continue
          const jr = await judgeSighting({
            provider: handle.provider,
            model: judgeModel,
            golden: g,
            detected: best.sighting,
          })
          if (jr) {
            judge.set(g.title, { equivalence: jr.equivalence })
            judgeTokensIn += jr.tokensIn
            judgeTokensOut += jr.tokensOut
          }
        }
      }

      const score = scoreTaskFixture({
        fixture,
        model,
        detected: run.detected,
        tokenUsage: run.tokenUsage,
        judge: a.noLlmJudge ? undefined : judge,
        judgeCostUsd: a.noLlmJudge ? null : priceUsd(judgeModel, judgeTokensIn, judgeTokensOut),
      })
      scores.push(score)
      for (const n of score.newSightings) {
        newByKey.set([...n.activityIds].sort().join(','), n)
      }
      console.log(
        `  → found ${score.foundCount}/${score.positiveCount}, ` +
          `missed ${score.missedTitles.length}, reject-reproduced ${score.rejectedReproducedCount}, ` +
          `new ${score.newCount}, detected ${score.detectedCount}`,
      )
    }

    if (a.label && newByKey.size > 0) {
      const goldenPath = path.join(dir, 'golden.md')
      const blocks = renderLabelBlocks([...newByKey.values()])
      const existing = fs.existsSync(goldenPath) ? fs.readFileSync(goldenPath, 'utf8') : ''
      fs.writeFileSync(goldenPath, `${existing.trimEnd()}\n\n${blocks}`, 'utf8')
      console.log(
        `\n  📝 Appended ${newByKey.size} candidate(s) to ${path.relative(process.cwd(), goldenPath)} — set each Verdict to keep/reject.`,
      )
    }
  }

  const report: TaskEvalReport = {
    generatedAt: new Date().toISOString(),
    vendor: handle.vendor,
    judgeModel: a.noLlmJudge ? null : judgeModel,
    fixtures: scores,
  }

  fs.mkdirSync(a.out, { recursive: true })
  const stamp = report.generatedAt.replace(/[:.]/g, '-')
  const jsonPath = path.join(a.out, `${stamp}.json`)
  const mdPath = path.join(a.out, `${stamp}.md`)
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(mdPath, renderMarkdown(report), 'utf8')

  console.log('\n=== Scorecard ===')
  console.log(renderMarkdown(report))
  console.log(`\nWrote ${path.relative(process.cwd(), mdPath)}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
