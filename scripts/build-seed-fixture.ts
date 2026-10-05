#!/usr/bin/env npx tsx
/**
 * Builds synthetic task-mining fixtures from a hand-authored seed directory
 * (see evals/task-mining/seeds/<slug>/STYLE.md). No DB, no LLM.
 *
 * Usage:
 *   npm run build-seed-fixture -- --seed evals/task-mining/seeds/packaging-supplier
 *   npm run build-seed-fixture -- --seed <dir> --placement multitask
 */

import * as path from 'path'
import {
  fixtureName,
  renderTaskFixtureGoldenMd,
  type PlacementMode,
} from '../src/main/eval/task-fixture-build'
import {
  layoutSeedDay,
  loadTaskSeed,
  seedNoise,
  seedToRuns,
} from '../src/main/eval/task-fixture-seed'
import { TaskFixtureStore } from '../src/main/eval/task-fixture-store'
import { TASK_FIXTURE_SCHEMA_VERSION } from '../src/main/eval/task-types'

const FIXTURES_ROOT = path.resolve('evals/task-mining/fixtures')
const PLACEMENTS: PlacementMode[] = ['contiguous', 'multitask']

function parseArgs(): { seed: string; placements: PlacementMode[] } {
  const args = process.argv.slice(2)
  let seed = ''
  let placements = PLACEMENTS
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seed') seed = args[++i] ?? ''
    else if (args[i] === '--placement' || args[i] === '--placements') {
      placements = (args[++i] ?? '').split(',').map((s) => s.trim()) as PlacementMode[]
    }
  }
  const bad = placements.filter((p) => !PLACEMENTS.includes(p))
  if (!seed || bad.length) {
    console.error('Usage: --seed <dir> [--placement contiguous,multitask]')
    process.exit(1)
  }
  return { seed: path.resolve(seed), placements }
}

function main(): void {
  const args = parseArgs()
  const seed = loadTaskSeed(args.seed)
  const runs = seedToRuns(seed)
  const noise = seedNoise(seed)
  const store = new TaskFixtureStore(FIXTURES_ROOT)
  const keep = runs.filter((r) => r.block.verdict !== 'reject').length

  for (const placement of args.placements) {
    const all = layoutSeedDay(runs, noise, placement, seed.startMin)
    const name = fixtureName(seed.day, seed.slug, placement, 1, 'none')
    store.write(
      name,
      all,
      renderTaskFixtureGoldenMd(
        name,
        runs.map((r) => r.block),
        all,
      ),
      {
        name,
        label: name,
        description: `${placement} (seeded: ${keep} keep, ${runs.length - keep} reject)`,
        activityCount: all.length,
        sourceDay: seed.day,
        schemaVersion: TASK_FIXTURE_SCHEMA_VERSION,
      },
    )
    const last = all[all.length - 1]
    const end = last.offsetMin + last.durationMin
    console.log(
      `✓ ${name}: ${all.length} activities (${noise.length} noise), ${keep} keep + ` +
        `${runs.length - keep} reject runs, ${Math.floor(end / 60)}:${String(end % 60).padStart(2, '0')} end`,
    )
  }
}

main()
