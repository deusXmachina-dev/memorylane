#!/usr/bin/env npx tsx
/**
 * Backfills the `· App · tld` scanning label onto the time line of existing
 * `golden.md` fixtures. New goldens get this for free from `renderGoldenMd`; this
 * script brings already-committed goldens up to the same format.
 *
 * It does NOT regenerate the golden (your hand-edited summaries and boundaries
 * are preserved). It re-runs the same no-LLM scaffold replay that seeds a fresh
 * golden — `replayFixture` + `ScaffoldTransformer` — to recover the producer's
 * `tld` per activity (the exact value a fresh seed would emit), matches each
 * golden block to a replayed span by time overlap, and rewrites only that block's
 * time line in place: `mm:ss → mm:ss` → `mm:ss → mm:ss · App[ · tld]`. Every
 * other line (summaries, DROPPED markers, `---`, comments) is left byte-for-byte.
 * Re-running is a no-op (the label is recomputed identically).
 *
 * Usage:
 *   npm run backfill-golden-tld                         (all fixtures)
 *   npm run backfill-golden-tld -- --fixture jaro-2026-06-22-12-21
 *   npm run backfill-golden-tld -- --dry-run            (print, don't write)
 *   npm run backfill-golden-tld -- --root <fixtures-dir>
 */

import * as fs from 'fs'
import * as path from 'path'
import { replayFixture, ScaffoldTransformer } from '../src/main/eval/replay-harness'
import {
  HEADER_RE,
  TIME_RE,
  formatTimeLine,
  parseGoldenMd,
  type GoldenActivity,
} from '../src/main/eval/golden-md'

const DEFAULT_FIXTURES_ROOT = path.resolve('evals/semantic-summary/fixtures')

interface Args {
  fixtures: string[]
  root: string
  dryRun: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const a: Args = { fixtures: [], root: DEFAULT_FIXTURES_ROOT, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const next = (): string | undefined => argv[++i]
    switch (argv[i]) {
      case '--fixture':
      case '--fixtures':
        a.fixtures.push(
          ...(next() ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        )
        break
      case '--root':
        a.root = path.resolve(next() ?? DEFAULT_FIXTURES_ROOT)
        break
      case '--dry-run':
        a.dryRun = true
        break
      default:
        console.warn(`Unknown arg: ${argv[i]}`)
    }
  }
  return a
}

interface Span {
  startOffsetMs: number
  endOffsetMs: number
  tld?: string
}

/** Best-overlap tld for a golden block's [start,end] offset span. Zero-length
 *  spans (e.g. a `0:00 → 0:00` DROPPED block) fall back to point containment. */
function tldForSpan(startMs: number, endMs: number, spans: Span[]): string | undefined {
  let best: string | undefined
  let bestScore = 0
  for (const s of spans) {
    if (!s.tld) continue
    const score =
      startMs === endMs
        ? s.startOffsetMs <= startMs && startMs <= s.endOffsetMs
          ? 1
          : 0
        : Math.max(0, Math.min(endMs, s.endOffsetMs) - Math.max(startMs, s.startOffsetMs))
    if (score > bestScore) {
      bestScore = score
      best = s.tld
    }
  }
  return best
}

interface FixtureResult {
  name: string
  blocks: number
  labelled: number
  withTld: number
  changed: boolean
  error?: string
}

async function backfillFixture(fixtureDir: string, dryRun: boolean): Promise<FixtureResult> {
  const name = path.basename(fixtureDir)
  const goldenPath = path.join(fixtureDir, 'golden.md')
  if (!fs.existsSync(goldenPath)) {
    return { name, blocks: 0, labelled: 0, withTld: 0, changed: false, error: 'no golden.md' }
  }

  const text = fs.readFileSync(goldenPath, 'utf8')
  const blocks: GoldenActivity[] = parseGoldenMd(text)

  const { activities, droppedActivities, sessionStartMs } = await replayFixture({
    fixtureDir,
    transformer: new ScaffoldTransformer(),
  })
  const spans: Span[] = [...activities, ...droppedActivities].map((a) => ({
    startOffsetMs: a.startTimestamp - sessionStartMs,
    endOffsetMs: a.endTimestamp - sessionStartMs,
    tld: a.tld,
  }))

  // Walk lines and rewrite each block's first time line in document order. The
  // k-th `## ` header pairs with blocks[k]; its first following TIME line is the
  // one we patch. appName comes from the header (blocks[k]) so the label always
  // matches it; only the tld is freshly recovered.
  const lines = text.split('\n')
  let blockIdx = -1
  let awaitingTime = false
  let labelled = 0
  let withTld = 0
  for (let i = 0; i < lines.length; i++) {
    if (HEADER_RE.test(lines[i])) {
      blockIdx++
      awaitingTime = true
      continue
    }
    if (awaitingTime && TIME_RE.test(lines[i])) {
      awaitingTime = false
      const block = blocks[blockIdx]
      if (!block) continue
      const tld = tldForSpan(block.startOffsetMs, block.endOffsetMs, spans)
      const leadingWs = lines[i].match(/^\s*/)?.[0] ?? ''
      lines[i] =
        leadingWs + formatTimeLine(block.startOffsetMs, block.endOffsetMs, block.appName, tld)
      labelled++
      if (tld) withTld++
    }
  }

  const updated = lines.join('\n')
  const changed = updated !== text
  if (changed && !dryRun) fs.writeFileSync(goldenPath, updated, 'utf8')

  return { name, blocks: blocks.length, labelled, withTld, changed }
}

function listFixtureDirs(root: string, only: string[]): string[] {
  if (!fs.existsSync(root)) throw new Error(`Fixtures root not found: ${root}`)
  const all = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
  const wanted = only.length ? all.filter((n) => only.includes(n)) : all
  return wanted.map((n) => path.join(root, n))
}

async function main(): Promise<void> {
  const args = parseArgs()
  const dirs = listFixtureDirs(args.root, args.fixtures)
  if (dirs.length === 0) {
    console.error('No matching fixtures.')
    process.exit(1)
  }

  console.log(
    `Backfilling tld labels in ${dirs.length} fixture(s)${args.dryRun ? ' (dry run)' : ''}\n`,
  )
  const results: FixtureResult[] = []
  for (const dir of dirs) {
    try {
      results.push(await backfillFixture(dir, args.dryRun))
    } catch (err) {
      results.push({
        name: path.basename(dir),
        blocks: 0,
        labelled: 0,
        withTld: 0,
        changed: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  for (const r of results) {
    if (r.error) {
      console.log(`  ✗ ${r.name} — ${r.error}`)
    } else {
      const tag = r.changed ? (args.dryRun ? 'would update' : 'updated') : 'unchanged'
      console.log(
        `  ${r.changed ? '✓' : '·'} ${r.name} — ${tag}: ${r.labelled}/${r.blocks} blocks labelled, ${r.withTld} with tld`,
      )
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
