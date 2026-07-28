#!/usr/bin/env npx tsx
/**
 * Runs the REAL cluster content-review LLM call (runContentReview + the
 * production sanitizer) over canned ReviewInput fixtures and scores the
 * classification against expected verdicts. Headline: false-eliminable rate —
 * clusters promised as automatable procedures that a human judged otherwise.
 *
 * Fixtures: evals/task-mining/cluster-review/*.json (see ClusterReviewFixture
 * in src/main/eval/cluster-review-score.ts). Grow them from real clusters with
 * `npm run dump-review-input`.
 *
 * Usage:
 *   npm run eval-cluster-review                       (all fixtures, default model)
 *   npm run eval-cluster-review -- --fixture ambient  (name substring filter)
 *   npm run eval-cluster-review -- --model m1,m2      (model sweep)
 */

import { config as loadEnv } from 'dotenv'
loadEnv()

import * as fs from 'fs'
import * as path from 'path'
import { runContentReview } from '../src/main/services/task-miner/clustering/llm-review'
import {
  scoreClusterReview,
  aggregateClusterReviewScores,
  type ClusterReviewFixture,
  type ClusterReviewScore,
} from '../src/main/eval/cluster-review-score'
import { DEFAULT_MINER_CONFIG } from '../src/main/services/task-miner/types'
import { pct } from '../src/main/eval/format'
import { loadCliInferenceProvider } from './cli-inference-provider'

const FIXTURES_ROOT = path.resolve('evals/task-mining/cluster-review')

function parseArgs(): { fixtures: string[]; models: string[] } {
  const args = process.argv.slice(2)
  const a: { fixtures: string[]; models: string[] } = { fixtures: [], models: [] }
  const list = (s: string): string[] =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  for (let i = 0; i < args.length; i++) {
    const value = args[i + 1]
    if ((args[i] === '--fixture' || args[i] === '--fixtures') && value !== undefined) {
      a.fixtures.push(...list(value))
      i++
    } else if ((args[i] === '--model' || args[i] === '--models') && value !== undefined) {
      a.models = list(value)
      i++
    }
  }
  return a
}

function loadFixtures(filters: string[]): ClusterReviewFixture[] {
  if (!fs.existsSync(FIXTURES_ROOT)) {
    console.error(`No fixture dir at ${FIXTURES_ROOT} — create it and add *.json fixtures.`)
    process.exit(1)
  }
  const files = fs
    .readdirSync(FIXTURES_ROOT)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => filters.length === 0 || filters.some((s) => f.includes(s)))
    .sort()
  return files.map((f) => {
    const fixture = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_ROOT, f), 'utf8'),
    ) as ClusterReviewFixture
    fixture.name ||= f.replace(/\.json$/, '')
    return fixture
  })
}

async function main() {
  const a = parseArgs()
  const fixtures = loadFixtures(a.fixtures)
  if (fixtures.length === 0) {
    console.error(`No fixtures matched in ${FIXTURES_ROOT}.`)
    process.exit(1)
  }

  const handle = loadCliInferenceProvider()
  const models =
    a.models.length > 0 ? a.models : [handle.patternDetectionModel || DEFAULT_MINER_CONFIG.model]

  console.log('=== Cluster-Review Eval ===')
  console.log(`Vendor:   ${handle.vendor}${handle.baseURL ? ` (${handle.baseURL})` : ''}`)
  console.log(`Models:   ${models.join(', ')}`)
  console.log(`Fixtures: ${fixtures.map((f) => f.name).join(', ')}`)

  let failed = 0
  for (const model of models) {
    const scores: ClusterReviewScore[] = []
    for (const fixture of fixtures) {
      console.log(`\n--- ${fixture.name} × ${model} ---`)
      try {
        const result = await runContentReview(handle.provider, model, fixture.input, (msg) =>
          console.log(`  ${msg}`),
        )
        if (!result.output) {
          console.error('  ✖ unparseable review response')
          failed++
          continue
        }
        const score = scoreClusterReview({
          fixture,
          model,
          output: result.output,
          tokenUsage: result.tokenUsage,
        })
        scores.push(score)
        console.log(
          `  → kind ${score.kindCorrect}/${score.verdictCount}, ` +
            `false-eliminable ${score.falseEliminable}, missed-procedure ${score.missedProcedure}, ` +
            `unclassified ${score.unclassified}`,
        )
      } catch (err) {
        console.error(`  ✖ failed: ${err instanceof Error ? err.message : String(err)}`)
        failed++
      }
    }

    if (scores.length > 0) {
      const agg = aggregateClusterReviewScores(scores)
      console.log(`\n=== ${model} ===`)
      console.log(
        `Kind accuracy:        ${pct(agg.verdictCount ? agg.kindCorrect / agg.verdictCount : null)} ` +
          `(${agg.kindCorrect}/${agg.verdictCount}, ${agg.unclassified} unclassified)`,
      )
      console.log(
        `FALSE-ELIMINABLE:     ${agg.falseEliminable} (${pct(agg.falseEliminableRate)} of non-procedures)`,
      )
      console.log(`Missed procedures:    ${agg.missedProcedure}`)
      for (const [kind, b] of Object.entries(agg.perKind)) {
        console.log(
          `  ${kind.padEnd(12)} ${b.correct}/${b.total} correct` +
            (kind !== 'procedure' && b.asProcedure > 0 ? `, ${b.asProcedure} as procedure ⚠` : ''),
        )
      }
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} run(s) failed — results are partial.`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
