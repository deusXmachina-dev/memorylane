#!/usr/bin/env npx tsx
/**
 * Builds task-mining fixtures by promoting a semantic-summary fixture's golden
 * into a `keep` task and padding it with a real dev-DB day as noise, so the
 * miner must *find* the task amid realistic activity.
 *
 * Two placement modes per day:
 *   - contiguous: the task runs uninterrupted in a quiet gap (tests recall).
 *   - multitask:  the task's steps are spread across the day's busiest window so
 *                 unrelated activities fall *between* them (tests grounding
 *                 precision — the miner must stitch the task across the
 *                 interruptions and exclude them from its set).
 *
 * Recurring tasks: `--occurrences N` plants the task N times across the day, each
 * in its own slice of noise (so the miner should surface N distinct sightings and
 * cluster them). With N > 1 the occurrences are *varied* so they aren't identical
 * copies (`--vary`):
 *   - reorder (default): the steps are slightly reordered per occurrence (no LLM).
 *   - llm:               the step summaries are paraphrased per occurrence via the
 *                        active vendor's model (same meaning, different wording).
 *   - none:              identical copies.
 *
 * Output: evals/task-mining/fixtures/<day>-jaro-contract[-multitask][-xN]/, each
 * `activities.jsonl` + `golden.md` (one keep block per occurrence) + `manifest.json`.
 * Deterministic unless `--vary llm`. The dev DB is read read-only.
 *
 * Usage:
 *   npm run build-task-fixture -- --noise-day 2026-06-10,2026-06-05 --keep-exclude 1
 *   npm run build-task-fixture -- --noise-day 2026-06-10 --occurrences 3 --placement multitask
 *   npm run build-task-fixture -- --noise-day 2026-06-10 --occurrences 3 --vary llm
 *
 * --keep-exclude takes 1-based indices over the source's non-dropped blocks to
 * leave OUT of the golden `keep` task (they stay as day activities). For the
 * jaro fixture, `--keep-exclude 1` drops the recorder-start activity so the
 * miner is scored on grounding precision (it must not absorb that activity).
 */

import { config as loadEnv } from 'dotenv'
loadEnv()

import * as fs from 'fs'
import * as path from 'path'
import { StorageService } from '../src/main/storage'
import { getDefaultDbPath } from '../src/main/paths'
import { PATTERN_DETECTION_CONFIG } from '../src/shared/constants'
import { loadGoldenMd } from '../src/main/eval/golden-md'
import {
  applyParaphrasedSummaries,
  cloneOccurrence,
  placeOccurrences,
  renderTaskFixtureGoldenMd,
  semanticGoldenToTask,
  toFixtureActivity,
  type PlacementMode,
  type SemanticTaskResult,
} from '../src/main/eval/task-fixture-build'
import { TaskFixtureStore } from '../src/main/eval/task-fixture-store'
import { callJsonJudge } from '../src/main/eval/llm-judge'
import type { InferenceProvider } from '../src/main/llm'
import { loadCliInferenceProvider } from './cli-inference-provider'
import {
  TASK_FIXTURE_SCHEMA_VERSION,
  type TaskFixtureActivity,
  type TaskFixtureManifest,
} from '../src/main/eval/task-types'

const DAY_MS = 24 * 60 * 60 * 1000
const SEMANTIC_ROOT = path.resolve('evals/semantic-summary/fixtures')
const FIXTURES_ROOT = path.resolve('evals/task-mining/fixtures')

const DEFAULT_FROM = 'jaro-2026-06-19-09-43'
const DEFAULT_TITLE = 'Set up a new customer in Drive (folder + Services Agreement + DPA)'
const DEFAULT_DESCRIPTION =
  'Created a "new customer - test" folder in Google Drive, copied the MemoryLane Services ' +
  'Agreement and DPA templates into it, filled in the customer party names and engagement terms ' +
  '(party, Pilot type, term, fees, deployment schedule), and shared both documents with Petr.'

type VaryMode = 'none' | 'reorder' | 'llm'
const VARY_MODES: VaryMode[] = ['none', 'reorder', 'llm']

interface CliArgs {
  from: string
  noiseDays: string[]
  placements: PlacementMode[]
  title: string
  description: string
  dbPath: string
  interruptions: number
  keepExclude: number[]
  occurrences: number
  vary: VaryMode | ''
  varyModel: string
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const list = (s: string): string[] =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  const a: CliArgs = {
    from: DEFAULT_FROM,
    noiseDays: [],
    placements: ['contiguous', 'multitask'],
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    dbPath: getDefaultDbPath(),
    interruptions: 3,
    keepExclude: [],
    occurrences: 1,
    vary: '',
    varyModel: '',
  }
  for (let i = 0; i < args.length; i++) {
    const next = args[i + 1]
    if (next === undefined) break
    switch (args[i]) {
      case '--from':
        a.from = next
        i++
        break
      case '--keep-exclude':
        a.keepExclude = list(next).map(Number).filter(Number.isFinite)
        i++
        break
      case '--noise-day':
      case '--noise-days':
        a.noiseDays.push(...list(next))
        i++
        break
      case '--placement':
      case '--placements':
        a.placements = list(next) as PlacementMode[]
        i++
        break
      case '--title':
        a.title = next
        i++
        break
      case '--description':
        a.description = next
        i++
        break
      case '--db-path':
        a.dbPath = next
        i++
        break
      case '--interruptions':
        a.interruptions = Number(next)
        i++
        break
      case '--occurrences':
      case '--repeat':
        a.occurrences = Math.max(1, Math.floor(Number(next)) || 1)
        i++
        break
      case '--vary':
        a.vary = next as VaryMode
        i++
        break
      case '--vary-model':
        a.varyModel = next
        i++
        break
    }
  }
  return a
}

/** jaro-2026-06-19-09-43 → jaro-2026-06-19 (drop a trailing -HH-MM time). */
function idPrefixFrom(from: string): string {
  return from.replace(/-\d{2}-\d{2}$/, '')
}

/** Local midnight (ms) for a YYYY-MM-DD day string. */
function dayStartLocal(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

/**
 * Paraphrases an occurrence's step summaries via the active vendor's model: same
 * meaning, different wording (a different day's run of the same recurring task).
 * Falls back to the original summaries on any LLM/parse failure or length
 * mismatch, so a bad call degrades the fixture rather than aborting the build.
 */
async function paraphraseSummaries(
  provider: InferenceProvider,
  model: string,
  summaries: string[],
  occurrenceIndex: number,
): Promise<string[]> {
  const prompt = [
    'These are the ordered step summaries of one run of a recurring task someone',
    'did on their computer. Rewrite EACH summary to describe the SAME action on a',
    'different day: keep the meaning, the app/website, and the concrete action',
    'identical, but vary the wording (verbs, phrasing, incidental detail). Do NOT',
    'merge, split, add, or drop steps — return exactly as many rewrites as inputs,',
    'in the same order.',
    `This is occurrence #${occurrenceIndex}; make the wording clearly distinct.`,
    '',
    'Steps:',
    ...summaries.map((s, i) => `${i + 1}. ${s}`),
    '',
    'Respond with ONLY JSON: {"summaries": ["<rewrite 1>", "<rewrite 2>", ...]}',
  ].join('\n')

  const res = await callJsonJudge<{ summaries?: unknown }>({
    provider,
    model,
    content: [{ type: 'text', text: prompt }],
    tag: 'task-vary',
  })
  const out = res?.parsed.summaries
  if (!Array.isArray(out) || out.length !== summaries.length) {
    console.warn(
      `  ⚠ variation: paraphrase failed/mismatched for occurrence ${occurrenceIndex} — keeping original wording.`,
    )
    return summaries
  }
  return out.map((s, i) => (typeof s === 'string' && s.trim() ? s : summaries[i]))
}

/** Builds the N varied occurrences once — their content is independent of the
 *  noise day / placement, so they're reused across every fixture written. */
async function buildOccurrences(
  base: SemanticTaskResult,
  count: number,
  vary: VaryMode,
  llm: { provider: InferenceProvider; model: string } | null,
): Promise<SemanticTaskResult[]> {
  const occurrences: SemanticTaskResult[] = []
  for (let k = 1; k <= count; k++) {
    let occ = cloneOccurrence(base, { index: k, total: count, reorder: vary !== 'none' })
    if (vary === 'llm' && llm) {
      const rewritten = await paraphraseSummaries(
        llm.provider,
        llm.model,
        occ.activities.map((a) => a.summary),
        k,
      )
      occ = applyParaphrasedSummaries(occ, rewritten)
    }
    occurrences.push(occ)
  }
  return occurrences
}

async function main(): Promise<void> {
  const a = parseArgs()

  const valid: PlacementMode[] = ['contiguous', 'multitask']
  const bad = a.placements.filter((p) => !valid.includes(p))
  if (bad.length) {
    console.error(`Unknown placement(s): ${bad.join(', ')}. Use contiguous and/or multitask.`)
    process.exit(1)
  }
  if (a.vary && !VARY_MODES.includes(a.vary)) {
    console.error(`Unknown --vary "${a.vary}". Use one of: ${VARY_MODES.join(', ')}.`)
    process.exit(1)
  }
  if (a.noiseDays.length === 0) {
    console.error('Pass --noise-day <YYYY-MM-DD>[,<YYYY-MM-DD>] (dev-DB day(s) to use as noise).')
    process.exit(1)
  }

  // Default: vary recurring tasks (reorder, no LLM) so occurrences aren't clones;
  // a single occurrence needs no variation.
  const vary: VaryMode = a.vary || (a.occurrences > 1 ? 'reorder' : 'none')

  const goldenPath = path.join(SEMANTIC_ROOT, a.from, 'golden.md')
  const goldens = loadGoldenMd(goldenPath)
  if (!goldens) {
    console.error(`No golden.md at ${goldenPath}`)
    process.exit(1)
  }
  const base = semanticGoldenToTask({
    goldens,
    idPrefix: idPrefixFrom(a.from),
    title: a.title,
    description: a.description,
    keepExclude: a.keepExclude,
  })

  if (!fs.existsSync(a.dbPath)) {
    console.error(`Dev DB not found at ${a.dbPath}. Run the app first or pass --db-path.`)
    process.exit(1)
  }

  // Only touch the LLM when actually paraphrasing — keeps the deterministic path
  // free of credentials/network.
  const llm =
    vary === 'llm'
      ? (() => {
          const handle = loadCliInferenceProvider()
          const model =
            a.varyModel || handle.patternDetectionModel || PATTERN_DETECTION_CONFIG.MODEL
          return { provider: handle.provider, model, vendor: handle.vendor }
        })()
      : null

  console.log('=== Build Task-Mining Fixture ===')
  console.log(
    `From:        ${a.from} (${base.activities.length} activities, ${base.block.activityIds.length} in the keep task` +
      `${a.keepExclude.length ? `, excluded ${a.keepExclude.join(',')}` : ''})`,
  )
  console.log(`DB:          ${a.dbPath}`)
  console.log(`Noise days:  ${a.noiseDays.join(', ')}`)
  console.log(`Placements:  ${a.placements.join(', ')}`)
  console.log(
    `Occurrences: ${a.occurrences}${a.occurrences > 1 ? ` (vary: ${vary}${llm ? ` via ${llm.model}` : ''})` : ''}`,
  )
  console.log('')

  const occurrences = await buildOccurrences(base, a.occurrences, vary, llm)
  const blocks = occurrences.map((o) => o.block)
  const occActivities = occurrences.map((o) => o.activities)

  const storage = new StorageService(a.dbPath)
  const store = new TaskFixtureStore(FIXTURES_ROOT)
  try {
    for (const day of a.noiseDays) {
      const dayStart = dayStartLocal(day)
      const details = storage.activities.getForDay(dayStart, dayStart + DAY_MS)
      if (details.length === 0) {
        console.warn(`  ⚠ ${day}: no activities in the dev DB — skipping.`)
        continue
      }
      const stored = storage.activities.getByIds(details.map((d) => d.id))
      const noise: TaskFixtureActivity[] = stored.map((s) => toFixtureActivity(s, dayStart))

      for (const placement of a.placements) {
        const { placed, warnings } = placeOccurrences(occActivities, noise, placement, {
          interruptions: a.interruptions,
        })
        const taskActivities = placed.flat()
        const all = [...noise, ...taskActivities].sort((x, y) => x.offsetMin - y.offsetMin)
        const suffix = `${placement === 'multitask' ? '-multitask' : ''}${a.occurrences > 1 ? `-x${a.occurrences}` : ''}`
        const name = `${day}-jaro-contract${suffix}`
        const goldenMd = renderTaskFixtureGoldenMd(name, blocks, all)
        const manifest: TaskFixtureManifest = {
          name,
          label: name,
          description: a.occurrences > 1 ? `${placement} ×${a.occurrences} (${vary})` : placement,
          activityCount: all.length,
          sourceDay: day,
          schemaVersion: TASK_FIXTURE_SCHEMA_VERSION,
        }
        store.write(name, all, goldenMd, manifest)

        const spans = placed
          .map((p) => `${p[0].offsetMin}–${p[p.length - 1].offsetMin}min`)
          .join(', ')
        console.log(
          `  ✓ ${name}: ${noise.length} noise + ${taskActivities.length} task ` +
            `(${a.occurrences}×) = ${all.length} activities (@ ${spans})`,
        )
        for (const w of warnings) console.warn(`    ⚠ ${w}`)
      }
    }
  } finally {
    storage.close()
  }

  console.log(`\nWrote fixtures to ${path.relative(process.cwd(), FIXTURES_ROOT)}/`)
  console.log('Next: score the miner —  npm run eval-tasks -- --fixture <name>')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
