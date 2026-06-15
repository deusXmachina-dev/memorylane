#!/usr/bin/env npx tsx
/**
 * Seeds committed pattern-detection fixtures into a temp DB, runs the REAL
 * detector against each, and scores whether it found the hidden pattern(s):
 * deterministic grounding (did detected sightings reference the needle
 * activities?) + a spurious-pattern count, plus an optional LLM judge (semantic
 * equivalence with the golden + automation-idea quality). Writes a findings-style
 * Markdown scorecard + JSON.
 *
 * Each fixture is a hand-authored day of activities (mostly noise) with a real
 * automatable pattern hidden inside it; see evals/pattern-detection/README.md.
 * Needs no live app — just capture-settings.json / vendor-credentials.json + an
 * API key.
 *
 * Usage:
 *   npm run eval-patterns -- --fixtures openrouter-credits
 *   npm run eval-patterns -- --fixtures a,b --models m1,m2 --judge-model X
 *   npm run eval-patterns -- --fixtures X --no-llm-judge          (deterministic only, free)
 *   npm run eval-patterns -- --fixtures-dir evals/pattern-detection/fixtures
 */

import { config as loadEnv } from 'dotenv'
loadEnv()

import * as fs from 'fs'
import * as path from 'path'
import { EmbeddingService } from '../src/main/processor/embedding'
import { PATTERN_DETECTION_CONFIG } from '../src/shared/constants'
import { loadPatternFixture, runPatternFixture } from '../src/main/eval/pattern-replay'
import { scorePatternFixture, bestDetectedForGolden } from '../src/main/eval/pattern-score'
import { judgePattern } from '../src/main/eval/pattern-judge'
import { priceUsd } from '../src/main/eval/cost'
import type {
  PatternEvalReport,
  PatternFixtureScore,
  PatternJudgeScore,
} from '../src/main/eval/pattern-types'
import { loadCliInferenceProvider } from './cli-inference-provider'

const FIXTURES_ROOT = path.resolve('evals/pattern-detection/fixtures')
const DEFAULT_RESULTS_DIR = path.resolve('evals/pattern-detection/results')

interface CliArgs {
  fixtures: string[]
  fixturesDir: string | null
  models: string[]
  lookback: number
  judgeModel: string | null
  noLlmJudge: boolean
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

function renderMarkdown(report: PatternEvalReport): string {
  const lines: string[] = []
  lines.push(`# Pattern-Detection Eval — ${report.generatedAt}`)
  lines.push('')
  lines.push(`- Vendor: ${report.vendor}`)
  lines.push(`- Judge: ${report.judgeModel ?? '(none)'}`)
  lines.push('')
  lines.push('## Scorecard')
  lines.push('')
  lines.push(
    '| Fixture | Model | Goldens | Recall | Grounding | Spurious | Equiv | Auto/10 | Conf | Cost |',
  )
  lines.push('|---|---|--:|--:|--:|--:|--:|--:|--:|--:|')
  for (const f of report.fixtures) {
    lines.push(
      `| ${f.fixture} | ${f.model} | ${f.foundCount}/${f.goldenCount} | ${pct(f.recall)} | ` +
        `${pct(f.avgGroundingRecall)} | ${f.spuriousCount} | ${num(f.avgEquivalence)} | ` +
        `${num(f.avgAutomationQuality, 1)} | ${num(f.avgConfidence)} | ${usd(f.costUsd)} |`,
    )
  }
  lines.push('')
  lines.push('## Detail')
  for (const f of report.fixtures) {
    lines.push('')
    lines.push(`### ${f.fixture} | ${f.model}`)
    lines.push(`> ${f.detectedCount} pattern(s) detected; ${f.spuriousCount} spurious`)
    if (f.spuriousNames.length) lines.push(`> spurious: ${f.spuriousNames.join('; ')}`)
    for (const g of f.goldenScores) {
      const mark = g.found ? '✅' : '❌'
      lines.push('')
      lines.push(`- ${mark} **${g.goldenName}** → ${g.matchedPatternName ?? '(no match)'}`)
      lines.push(
        `  - grounding: recall ${pct(g.grounding.recall)}, precision ${pct(g.grounding.precision)}, ` +
          `IoU ${pct(g.grounding.iou)} (${g.grounding.matchedIds.length} needle ids), ` +
          `${g.sightingCount} sighting(s), conf ${num(g.avgConfidence)}`,
      )
      if (g.equivalence != null || g.automationQuality != null) {
        lines.push(
          `  - judge: equiv ${num(g.equivalence)}, automation ${num(g.automationQuality, 1)}/10` +
            (g.automationNotes ? ` — ${g.automationNotes}` : ''),
        )
      }
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

  console.log('=== Pattern-Detection Eval ===')
  console.log(`Vendor:   ${handle.vendor}${handle.baseURL ? ` (${handle.baseURL})` : ''}`)
  console.log(`Models:   ${models.join(', ')}`)
  console.log(`Judge:    ${a.noLlmJudge ? '(disabled)' : judgeModel}`)
  console.log(`Lookback: ${a.lookback}d`)
  console.log(`Fixtures: ${dirs.map((d) => path.basename(d)).join(', ')}`)
  console.log('')

  const embedder = new EmbeddingService()
  await embedder.init()

  const scores: PatternFixtureScore[] = []

  for (const dir of dirs) {
    const fixture = loadPatternFixture(dir)
    for (const model of models) {
      console.log(`\n--- ${fixture.manifest.name} × ${model} ---`)
      const run = await runPatternFixture({
        provider: handle.provider,
        fixture,
        model,
        lookbackDays: a.lookback,
        embedder,
        onProgress: (msg) => console.log(`  ${msg}`),
      })

      const judge = new Map<string, PatternJudgeScore>()
      let judgeTokensIn = 0
      let judgeTokensOut = 0
      if (!a.noLlmJudge) {
        for (const g of fixture.golden.patterns) {
          const best = bestDetectedForGolden(g.needleActivityIds, run.detected)
          if (!best) continue
          const jr = await judgePattern({
            provider: handle.provider,
            model: judgeModel,
            golden: g,
            detected: best.pattern,
          })
          if (jr) {
            judge.set(g.id, {
              equivalence: jr.equivalence,
              automationQuality: jr.automationQuality,
              automationNotes: jr.automationNotes,
            })
            judgeTokensIn += jr.tokensIn
            judgeTokensOut += jr.tokensOut
          }
        }
      }

      const score = scorePatternFixture({
        fixture,
        model,
        detected: run.detected,
        tokenUsage: run.tokenUsage,
        judge: a.noLlmJudge ? undefined : judge,
        judgeCostUsd: a.noLlmJudge ? null : priceUsd(judgeModel, judgeTokensIn, judgeTokensOut),
      })
      scores.push(score)
      console.log(
        `  → recall ${score.foundCount}/${score.goldenCount}, ` +
          `spurious ${score.spuriousCount}, detected ${score.detectedCount}`,
      )
    }
  }

  const report: PatternEvalReport = {
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
