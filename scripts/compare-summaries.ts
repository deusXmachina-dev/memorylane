#!/usr/bin/env npx tsx
/**
 * Compares two arms of activity-summary eval runs activity by activity. An arm
 * is one or more runs of the same configuration (prompt + model + pipeline);
 * repeated runs are averaged in the metrics table and listed side by side in
 * the worksheet, matched by golden block.
 *
 * Usage:
 *   npm run compare-summaries -- --a <runId[,runId]> --b <runId[,runId]> [--out <file>]
 *
 * Run ids are directory names under evals/semantic-summary/results (or paths).
 * Run from the repo root.
 */

import * as fs from 'fs'
import * as path from 'path'
import { compareArms, renderCompareMarkdown, type Arm } from '../src/main/eval/compare'
import type { EvalReport } from '../src/main/eval/types'

const RESULTS_DIR = path.resolve('evals/semantic-summary/results')

function parseArgs(): { a: string[]; b: string[]; out: string | null } {
  const args = process.argv.slice(2)
  const parsed = { a: [] as string[], b: [] as string[], out: null as string | null }
  const list = (s: string): string[] =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  for (let i = 0; i < args.length; i++) {
    const v = args[i + 1]
    if (v === undefined) break
    switch (args[i]) {
      case '--a':
        parsed.a.push(...list(v))
        i++
        break
      case '--b':
        parsed.b.push(...list(v))
        i++
        break
      case '--out':
        parsed.out = v
        i++
        break
    }
  }
  if (parsed.a.length === 0 || parsed.b.length === 0) {
    throw new Error(
      'Usage: compare-summaries --a <runId[,runId]> --b <runId[,runId]> [--out <file>]',
    )
  }
  return parsed
}

function resolveRunDir(idOrPath: string): string {
  const asPath = path.resolve(idOrPath)
  if (fs.existsSync(path.join(asPath, 'report.json'))) return asPath
  const asId = path.join(RESULTS_DIR, idOrPath)
  if (fs.existsSync(path.join(asId, 'report.json'))) return asId
  throw new Error(`Run not found: "${idOrPath}"`)
}

function loadReport(runDir: string): EvalReport {
  return JSON.parse(fs.readFileSync(path.join(runDir, 'report.json'), 'utf8'))
}

function loadArm(name: string, ids: string[]): Arm {
  const dirs = ids.map(resolveRunDir)
  return { name, runIds: dirs.map((d) => path.basename(d)), reports: dirs.map(loadReport) }
}

function main() {
  const args = parseArgs()
  const a = loadArm('A', args.a)
  const b = loadArm('B', args.b)
  const fixtures = compareArms(a, b)
  const md = renderCompareMarkdown(a, b, fixtures)
  const out = args.out
    ? path.resolve(args.out)
    : path.join(RESULTS_DIR, `compare-${a.runIds[0]}-vs-${b.runIds[0]}.md`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, md, 'utf8')
  console.log(md.split('\n## Worksheet')[0])
  console.log(`Wrote ${out}`)
}

main()
