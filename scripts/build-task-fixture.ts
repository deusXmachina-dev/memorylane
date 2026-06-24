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
 * Output: evals/task-mining/fixtures/<day>-jaro-contract[-multitask]/, each
 * `activities.jsonl` + `golden.md` + `manifest.json`. Deterministic; no LLM at
 * build time. The dev DB is read read-only.
 *
 * Usage:
 *   npm run build-task-fixture -- --noise-day 2026-06-10,2026-06-05 --keep-exclude 1
 *   npm run build-task-fixture -- --from jaro-2026-06-19-09-43 --noise-day 2026-06-10 \
 *     --placement multitask --keep-exclude 1 --title "..." --interruptions 4
 *
 * --keep-exclude takes 1-based indices over the source's non-dropped blocks to
 * leave OUT of the golden `keep` task (they stay as day activities). For the
 * jaro fixture, `--keep-exclude 1` drops the recorder-start activity so the
 * miner is scored on grounding precision (it must not absorb that activity).
 */

import * as fs from 'fs'
import * as path from 'path'
import { StorageService } from '../src/main/storage'
import { getDefaultDbPath } from '../src/main/paths'
import { loadGoldenMd } from '../src/main/eval/golden-md'
import {
  placeTask,
  renderSightingGoldenMd,
  semanticGoldenToTask,
  toFixtureActivity,
  type PlacementMode,
} from '../src/main/eval/task-fixture-build'
import { TaskFixtureStore } from '../src/main/eval/task-fixture-store'
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

interface CliArgs {
  from: string
  noiseDays: string[]
  placements: PlacementMode[]
  title: string
  description: string
  dbPath: string
  interruptions: number
  keepExclude: number[]
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

function main(): void {
  const a = parseArgs()

  const valid: PlacementMode[] = ['contiguous', 'multitask']
  const bad = a.placements.filter((p) => !valid.includes(p))
  if (bad.length) {
    console.error(`Unknown placement(s): ${bad.join(', ')}. Use contiguous and/or multitask.`)
    process.exit(1)
  }
  if (a.noiseDays.length === 0) {
    console.error('Pass --noise-day <YYYY-MM-DD>[,<YYYY-MM-DD>] (dev-DB day(s) to use as noise).')
    process.exit(1)
  }

  const goldenPath = path.join(SEMANTIC_ROOT, a.from, 'golden.md')
  const goldens = loadGoldenMd(goldenPath)
  if (!goldens) {
    console.error(`No golden.md at ${goldenPath}`)
    process.exit(1)
  }
  const { activities: task, block } = semanticGoldenToTask({
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

  console.log('=== Build Task-Mining Fixture ===')
  console.log(
    `From:       ${a.from} (${task.length} activities, ${block.activityIds.length} in the keep task` +
      `${a.keepExclude.length ? `, excluded ${a.keepExclude.join(',')}` : ''})`,
  )
  console.log(`DB:         ${a.dbPath}`)
  console.log(`Noise days: ${a.noiseDays.join(', ')}`)
  console.log(`Placements: ${a.placements.join(', ')}`)
  console.log('')

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
        const placed = placeTask(task, noise, placement, { interruptions: a.interruptions })
        const all = [...noise, ...placed].sort((x, y) => x.offsetMin - y.offsetMin)
        const name = `${day}-jaro-contract${placement === 'multitask' ? '-multitask' : ''}`
        const goldenMd = renderSightingGoldenMd(name, block, all)
        const manifest: TaskFixtureManifest = {
          name,
          label: name,
          description: placement,
          activityCount: all.length,
          sourceDay: day,
          schemaVersion: TASK_FIXTURE_SCHEMA_VERSION,
        }
        store.write(name, all, goldenMd, manifest)
        const span = `${placed[0].offsetMin}–${placed[placed.length - 1].offsetMin}min`
        console.log(
          `  ✓ ${name}: ${noise.length} noise + ${placed.length} task = ${all.length} activities (task @ ${span})`,
        )
      }
    }
  } finally {
    storage.close()
  }

  console.log(`\nWrote fixtures to ${path.relative(process.cwd(), FIXTURES_ROOT)}/`)
  console.log('Next: score the miner —  npm run eval-tasks -- --fixture <name>')
}

main()
