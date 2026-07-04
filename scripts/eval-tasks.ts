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
 * evals/task-mining/README.md. Reads the app's own settings/credentials (active
 * vendor, API key from env); needs no live app.
 *
 * Usage:
 *   npm run eval-tasks                                    (all fixtures, default model, no judge)
 *   npm run eval-tasks -- --fixture 2026-06-10 --label   (append found sightings to golden.md to thumbs)
 *   npm run eval-tasks -- --fixture 2026-06-10           (score against your keep/reject labels)
 *   npm run eval-tasks -- --model m1 --judge             (semantic-equivalence judge, paid)
 *   npm run eval-tasks -- --two-phase                     (re-enable Phase 2 grounding calls;
 *                                                          scan-only/one-shot is the default)
 */

import { config as loadEnv } from 'dotenv'
loadEnv()

import * as fs from 'fs'
import * as path from 'path'
import { EmbeddingService } from '../src/main/processor/embedding'
import { PATTERN_DETECTION_CONFIG } from '../src/shared/constants'
import { DEFAULT_MINER_CONFIG } from '../src/main/services/task-miner/types'
import { loadTaskFixture, runTaskFixture } from '../src/main/eval/task-replay'
import { scoreTaskFixture, bestDetectedForGolden } from '../src/main/eval/task-score'
import { renderLabelBlocks } from '../src/main/eval/task-golden-md'
import { renderTaskMarkdown, writeTaskReport } from '../src/main/eval/task-report'
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
const RESULTS_DIR = path.resolve('evals/task-mining/results')
const LOOKBACK_DAYS = PATTERN_DETECTION_CONFIG.LOOKBACK_DAYS

interface CliArgs {
  fixtures: string[]
  models: string[]
  judge: boolean
  label: boolean
  scanOnly: boolean
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const a: CliArgs = {
    fixtures: [],
    models: [],
    judge: false,
    label: false,
    scanOnly: DEFAULT_MINER_CONFIG.scanOnly,
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
      case '--models':
      case '--model':
        i = take((v) => (a.models = list(v)), i)
        break
      case '--judge':
        a.judge = true
        break
      case '--label':
        a.label = true
        break
      case '--scan-only':
        a.scanOnly = true
        break
      case '--two-phase':
        a.scanOnly = false
        break
    }
  }
  return a
}

/** Named fixtures, or every fixture in the standard root when none are named. */
function resolveFixtureDirs(a: CliArgs): string[] {
  if (a.fixtures.length) return a.fixtures.map((name) => path.join(FIXTURES_ROOT, name))
  return fs
    .readdirSync(FIXTURES_ROOT)
    .map((name) => path.join(FIXTURES_ROOT, name))
    .filter((p) => fs.existsSync(path.join(p, 'manifest.json')))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const a = parseArgs()
  const dirs = resolveFixtureDirs(a)
  if (dirs.length === 0) {
    console.error(`No fixtures in ${FIXTURES_ROOT}. Pass --fixture <name> or add fixtures there.`)
    process.exit(1)
  }

  const handle = loadCliInferenceProvider()
  const models =
    a.models.length > 0 ? a.models : [handle.patternDetectionModel || DEFAULT_MINER_CONFIG.model]
  const judgeModel = models[0]

  console.log('=== Task-Mining Eval ===')
  console.log(`Vendor:   ${handle.vendor}${handle.baseURL ? ` (${handle.baseURL})` : ''}`)
  console.log(`Models:   ${models.join(', ')}`)
  console.log(`Judge:    ${a.judge ? judgeModel : '(disabled)'}`)
  console.log(`Lookback: ${LOOKBACK_DAYS}d`)
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
      // One flaky API call must not kill the whole sweep — score what we have
      // and move on to the next model/fixture.
      try {
        const run = await runTaskFixture({
          provider: handle.provider,
          fixture,
          model,
          lookbackDays: LOOKBACK_DAYS,
          embedder,
          scanOnly: a.scanOnly,
          onProgress: (msg) => console.log(`  ${msg}`),
        })

        const judge = new Map<string, TaskJudgeScore>()
        let judgeTokensIn = 0
        let judgeTokensOut = 0
        if (a.judge) {
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
          judge: a.judge ? judge : undefined,
          judgeCostUsd: a.judge ? priceUsd(judgeModel, judgeTokensIn, judgeTokensOut) : null,
          mode: a.scanOnly ? 'scan-only' : 'two-phase',
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
      } catch (err) {
        console.error(
          `  ✖ ${fixture.manifest.name} × ${model} failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
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
    judgeModel: a.judge ? judgeModel : null,
    fixtures: scores,
  }

  const mdPath = writeTaskReport(RESULTS_DIR, report)
  console.log('\n=== Scorecard ===')
  console.log(renderTaskMarkdown(report))
  console.log(`\nWrote ${path.relative(process.cwd(), mdPath)}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
