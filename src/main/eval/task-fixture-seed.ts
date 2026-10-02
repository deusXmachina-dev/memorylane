/**
 * Builds a fully synthetic task-mining fixture from a hand-authored seed
 * directory: `seed.json` (slug, day, startMin), `tasks/*.json` (one task and
 * its runs each) and `noise.json` (the day's in-between activity). Runs and
 * noise are laid out back-to-back from `startMin`, so no real noise day is needed.
 */

import * as fs from 'fs'
import * as path from 'path'
import type { GoldenBlockSeed, PlacementMode } from './task-fixture-build'
import type { TaskFixtureActivity } from './task-types'

export interface TaskSeedStep {
  app: string
  windowTitle?: string
  tld?: string | null
  durationMin: number
  summary: string
}

export interface TaskSeedRun {
  description?: string
  steps: TaskSeedStep[]
}

export interface TaskSeedTask {
  title: string
  description?: string
  verdict?: 'keep' | 'reject'
  runs: TaskSeedRun[]
}

export interface TaskSeed {
  slug: string
  day: string
  startMin: number
  tasks: TaskSeedTask[]
  noise: TaskSeedStep[]
}

export interface SeedRun {
  activities: TaskFixtureActivity[]
  block: GoldenBlockSeed
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function assertStep(step: TaskSeedStep, where: string): void {
  if (!step.app || !step.summary || !Number.isInteger(step.durationMin) || step.durationMin < 1) {
    throw new Error(`${where}: step needs app, summary and an integer durationMin >= 1`)
  }
}

export function validateTaskSeed(seed: TaskSeed): TaskSeed {
  if (!seed.slug || !/^\d{4}-\d{2}-\d{2}$/.test(seed.day) || !Number.isInteger(seed.startMin)) {
    throw new Error('seed.json needs slug, day (YYYY-MM-DD) and an integer startMin')
  }
  seed.tasks.forEach((task, ti) => {
    if (!task.title || task.runs.length === 0) {
      throw new Error(`task ${ti + 1}: needs a title and at least one run`)
    }
    task.runs.forEach((run, ri) => {
      if (run.steps.length === 0) throw new Error(`${task.title} run ${ri + 1}: no steps`)
      run.steps.forEach((s, si) => assertStep(s, `${task.title} run ${ri + 1} step ${si + 1}`))
    })
  })
  seed.noise.forEach((s, i) => assertStep(s, `noise ${i + 1}`))
  return seed
}

export function loadTaskSeed(dir: string): TaskSeed {
  const meta = readJson(path.join(dir, 'seed.json')) as Pick<TaskSeed, 'slug' | 'day' | 'startMin'>
  const tasksDir = path.join(dir, 'tasks')
  const tasks = fs
    .readdirSync(tasksDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => readJson(path.join(tasksDir, f)) as TaskSeedTask)
  const noisePath = path.join(dir, 'noise.json')
  const noise = fs.existsSync(noisePath) ? (readJson(noisePath) as TaskSeedStep[]) : []
  return validateTaskSeed({ ...meta, tasks, noise })
}

function toActivity(step: TaskSeedStep, id: string): TaskFixtureActivity {
  return {
    id,
    offsetMin: 0,
    durationMin: step.durationMin,
    app: step.app,
    windowTitle: step.windowTitle ?? '',
    tld: step.tld ?? null,
    summary: step.summary,
    ocrText: '',
  }
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

export function seedToRuns(seed: TaskSeed): SeedRun[] {
  const perTask = seed.tasks.map((task, ti) =>
    task.runs.map((run, ri): SeedRun => {
      const activities = run.steps.map((s, si) =>
        toActivity(s, `${seed.slug}-t${ti + 1}-r${ri + 1}-${pad(si + 1)}`),
      )
      const total = task.runs.length
      return {
        activities,
        block: {
          title: total > 1 ? `${task.title} (${ri + 1}/${total})` : task.title,
          apps: [...new Set(activities.map((a) => a.tld || a.app))],
          activityIds: activities.map((a) => a.id),
          description: run.description ?? task.description ?? '',
          verdict: task.verdict ?? 'keep',
        },
      }
    }),
  )
  const rounds = Math.max(...perTask.map((r) => r.length))
  const interleaved: SeedRun[] = []
  for (let r = 0; r < rounds; r++) {
    for (const runs of perTask) if (runs[r]) interleaved.push(runs[r])
  }
  return interleaved
}

export function seedNoise(seed: TaskSeed): TaskFixtureActivity[] {
  return seed.noise.map((s, i) => toActivity(s, `${seed.slug}-n-${pad(i + 1, 3)}`))
}

function splitChunks<T>(items: readonly T[], count: number): T[][] {
  return Array.from({ length: count }, (_, i) =>
    items.slice(
      Math.floor((i * items.length) / count),
      Math.floor(((i + 1) * items.length) / count),
    ),
  )
}

/**
 * Lays the day out back-to-back from `startMin`: noise chunk, run, noise chunk,
 * run, … In `multitask` mode the chunk that follows a run is instead spread
 * evenly between the run's consecutive steps.
 */
export function layoutSeedDay(
  runs: readonly SeedRun[],
  noise: readonly TaskFixtureActivity[],
  mode: PlacementMode,
  startMin: number,
): TaskFixtureActivity[] {
  const chunks = splitChunks(noise, runs.length + 1)
  const out: TaskFixtureActivity[] = []
  let cursor = startMin
  const emit = (a: TaskFixtureActivity): void => {
    out.push({ ...a, offsetMin: cursor })
    cursor += a.durationMin
  }

  chunks[0].forEach(emit)
  runs.forEach((run, i) => {
    const next = chunks[i + 1]
    const gaps = run.activities.length - 1
    if (mode === 'contiguous' || gaps === 0) {
      run.activities.forEach(emit)
      next.forEach(emit)
      return
    }
    const between = splitChunks(next, gaps)
    run.activities.forEach((a, si) => {
      if (si > 0) between[si - 1].forEach(emit)
      emit(a)
    })
  })
  return out
}
