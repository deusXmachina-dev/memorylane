#!/usr/bin/env npx tsx
/**
 * Exports a whole day of activities from the dev DB into a task-mining fixture.
 *
 * The production miner scans an entire day in one pass, so the eval must too: a
 * fixture is a full real day (realistic volume), not a hand-picked handful. This
 * freezes every activity for the day into `activities.jsonl`, scaffolds an
 * editable `golden.md` (instructions + a chronological reference of the day), and
 * writes a manifest. No LLM is called.
 *
 * Then build the golden by labeling the miner's output:
 *   npm run eval-tasks -- --fixtures <name> --label   # appends found sightings
 *   # set each Verdict to keep/reject in golden.md, then:
 *   npm run eval-tasks -- --fixtures <name>           # score against your labels
 *
 * Usage:
 *   npm run export-day -- --day 2026-06-10
 *   npm run export-day -- --day 2026-06-10 --name tue-deep-work
 *   npm run export-day -- --day 2026-06-10 --from 9:00 --to 18:00   (clip to a window)
 *   npm run export-day -- --day 2026-06-10 --db-path /path/to.db --force
 *
 * IMPORTANT: hand-review activities.jsonl for private content (window titles,
 * URLs, OCR text) before committing it — real screen text is frozen in.
 */

import * as fs from 'fs'
import * as path from 'path'
import { StorageService } from '../src/main/storage'
import { getDefaultDbPath } from '../src/main/utils/paths'
import { renderTaskGoldenMd } from '../src/main/eval/task-golden-md'
import { toFixtureActivity } from '../src/main/eval/task-fixture-build'
import { TASK_FIXTURE_SCHEMA_VERSION, type TaskFixtureManifest } from '../src/main/eval/task-types'
import type { StoredActivity } from '../src/main/storage/types'

const FIXTURES_ROOT = path.resolve('evals/task-mining/fixtures')

interface CliArgs {
  name: string | null
  day: string | null
  from: string | null
  to: string | null
  dbPath: string
  force: boolean
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const a: CliArgs = {
    name: null,
    day: null,
    from: null,
    to: null,
    dbPath: getDefaultDbPath(),
    force: false,
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
      case '--day':
        if (next) {
          a.day = next
          i++
        }
        break
      case '--from':
        if (next) {
          a.from = next
          i++
        }
        break
      case '--to':
        if (next) {
          a.to = next
          i++
        }
        break
      case '--db-path':
        if (next) {
          a.dbPath = path.resolve(next)
          i++
        }
        break
      case '--force':
        a.force = true
        break
    }
  }
  if (!a.day) {
    console.error('Missing --day. Usage:')
    console.error(
      '  npm run export-day -- --day YYYY-MM-DD [--name <name>] [--from HH:MM --to HH:MM]',
    )
    process.exit(1)
  }
  return a
}

/** Local midnight (ms) of the given day string. */
function dayStartMs(day: string): number {
  const d = new Date(`${day}T00:00:00`)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Parses "HH:MM" into minutes-from-midnight. */
function hhmmToMin(s: string): number {
  const m = s.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) {
    console.error(`Bad time "${s}" — expected HH:MM (e.g. 14:05).`)
    process.exit(1)
  }
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

function main() {
  const a = parseArgs()
  const day = a.day as string
  const name = a.name ?? day
  const dir = path.join(FIXTURES_ROOT, name)
  if (fs.existsSync(dir) && !a.force) {
    console.error(`Fixture "${name}" already exists at ${dir}. Pass --force to overwrite.`)
    process.exit(1)
  }
  if (!fs.existsSync(a.dbPath)) {
    console.error(
      `No DB at ${a.dbPath}. Pass --db-path or run the app to capture activities first.`,
    )
    process.exit(1)
  }

  const dayStart = dayStartMs(day)
  const dayEnd = dayStart + 24 * 60 * 60 * 1000
  const fromMs = a.from ? dayStart + hhmmToMin(a.from) * 60_000 : dayStart
  const toMs = a.to ? dayStart + hhmmToMin(a.to) * 60_000 : dayEnd

  const storage = new StorageService(a.dbPath)
  let stored: StoredActivity[]
  try {
    const details = storage.activities.getForDay(dayStart, dayEnd)
    const inWindow = details.filter((d) => d.startTimestamp >= fromMs && d.startTimestamp < toMs)
    if (inWindow.length === 0) {
      console.error(
        `No activities on ${new Date(dayStart).toDateString()}` +
          (a.from || a.to ? ` in ${a.from ?? '00:00'}–${a.to ?? '24:00'}` : '') +
          `. Found ${details.length} that day. Check --day / --from / --to / --db-path.`,
      )
      process.exit(1)
    }
    // getForDay returns lightweight rows (no OCR); rehydrate full rows by id.
    stored = storage.activities.getByIds(inWindow.map((d) => d.id))
  } finally {
    storage.close()
  }

  const activities = stored
    .map((s) => toFixtureActivity(s, dayStart))
    .sort((x, y) => x.offsetMin - y.offsetMin)

  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'activities.jsonl'),
    activities.map((r) => JSON.stringify(r)).join('\n') + '\n',
    'utf8',
  )

  const goldenPath = path.join(dir, 'golden.md')
  if (!fs.existsSync(goldenPath) || a.force) {
    fs.writeFileSync(goldenPath, renderTaskGoldenMd(name, activities), 'utf8')
  }

  const window = a.from || a.to ? ` (${a.from ?? '00:00'}–${a.to ?? '24:00'})` : ''
  const manifest: TaskFixtureManifest = {
    name,
    label: name,
    description: `Exported day ${day}${window}; ${activities.length} activities.`,
    activityCount: activities.length,
    sourceDay: day,
    schemaVersion: TASK_FIXTURE_SCHEMA_VERSION,
  }
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  )

  console.log(`Exported day "${name}" -> ${path.relative(process.cwd(), dir)}`)
  console.log(`  Activities: ${activities.length}${window}`)
  console.log('')
  console.log('  Next — build the golden by labeling the miner:')
  console.log(`    1. npm run eval-tasks -- --fixtures ${name} --label   (appends candidates)`)
  console.log('    2. In golden.md, set each Verdict to keep (legit) or reject (stupid).')
  console.log(`    3. npm run eval-tasks -- --fixtures ${name}           (score against labels)`)
  console.log('')
  console.log('  ⚠  Hand-review activities.jsonl for private content before committing.')
}

main()
