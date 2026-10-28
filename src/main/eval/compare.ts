import { formatOffset } from './golden-md'
import { num as fmt, pct, usd } from './format'
import { aggregate, gitLabel, type Aggregate } from './report'
import type { EvalReport, FixtureScore, ScoredSummary } from './types'

export interface Arm {
  name: string
  runIds: string[]
  reports: EvalReport[]
}

export interface RunSummary {
  runId: string
  summary: ScoredSummary
}

export interface ActivityComparison {
  fixture: string
  goldenIndex: number
  golden: string
  appName: string
  windowTitle: string
  startOffsetMs: number
  endOffsetMs: number
  a: RunSummary[]
  b: RunSummary[]
  equivA: number | null
  equivB: number | null
  delta: number | null
  hardFailChanged: boolean
  mentionFlipped: string[]
}

export interface FixtureComparison {
  fixture: string
  activities: ActivityComparison[]
  unmatched: { a: RunSummary[]; b: RunSummary[] }
  a: Aggregate | null
  b: Aggregate | null
}

const REVIEW_DELTA = 0.1

const bigDelta = (d: number | null): boolean => d !== null && Math.abs(d) >= REVIEW_DELTA - 1e-9

const meanOrNull = (xs: number[]): number | null =>
  xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null

function fixtureScores(arm: Arm, fixture: string): { runId: string; score: FixtureScore }[] {
  const out: { runId: string; score: FixtureScore }[] = []
  arm.reports.forEach((report, i) => {
    const scores = report.fixtures.filter((f) => f.fixture === fixture)
    if (scores.length > 1) {
      throw new Error(
        `Run ${arm.runIds[i]} has ${scores.length} variants of "${fixture}". ` +
          'compare-summaries expects one model per run; re-run eval-summaries with a single --model.',
      )
    }
    if (scores[0]) out.push({ runId: arm.runIds[i], score: scores[0] })
  })
  return out
}

function perRunAggregate(scores: FixtureScore[], runs: number): Aggregate | null {
  if (scores.length === 0) return null
  const all = aggregate(scores)
  return {
    ...all,
    activities: all.activities / runs,
    matched: all.matched / runs,
    hardFails: all.hardFails / runs,
    costUsd: all.costUsd === null ? null : all.costUsd / runs,
  }
}

function missedUnion(runs: RunSummary[]): Set<string> {
  return new Set(runs.flatMap((r) => r.summary.golden?.mustMentionMissed ?? []))
}

const anyHardFail = (runs: RunSummary[]): boolean =>
  runs.some((r) => (r.summary.deterministic?.hardFails ?? 0) > 0)

export function compareArms(a: Arm, b: Arm): FixtureComparison[] {
  const fixtures = [
    ...new Set([...a.reports, ...b.reports].flatMap((r) => r.fixtures.map((f) => f.fixture))),
  ].sort()

  return fixtures.map((fixture) => {
    const aScores = fixtureScores(a, fixture)
    const bScores = fixtureScores(b, fixture)
    const byIndex = new Map<number, { a: RunSummary[]; b: RunSummary[] }>()
    const unmatched = { a: [] as RunSummary[], b: [] as RunSummary[] }

    const bucket = (side: 'a' | 'b', runs: { runId: string; score: FixtureScore }[]) => {
      for (const { runId, score } of runs) {
        for (const summary of score.summaries) {
          if (!summary.golden) {
            unmatched[side].push({ runId, summary })
            continue
          }
          let slot = byIndex.get(summary.golden.index)
          if (!slot) {
            slot = { a: [], b: [] }
            byIndex.set(summary.golden.index, slot)
          }
          slot[side].push({ runId, summary })
        }
      }
    }
    bucket('a', aScores)
    bucket('b', bScores)

    const activities = [...byIndex.entries()]
      .sort(([x], [y]) => x - y)
      .map(([goldenIndex, slot]) => {
        const any = (slot.a[0] ?? slot.b[0]).summary
        const equivA = meanOrNull(
          slot.a.map((r) => r.summary.golden!.equivalence).filter((n): n is number => n !== null),
        )
        const equivB = meanOrNull(
          slot.b.map((r) => r.summary.golden!.equivalence).filter((n): n is number => n !== null),
        )
        const missedA = missedUnion(slot.a)
        const missedB = missedUnion(slot.b)
        const mentionFlipped = [...new Set([...missedA, ...missedB])].filter(
          (f) => missedA.has(f) !== missedB.has(f),
        )
        return {
          fixture,
          goldenIndex,
          golden: any.golden!.summary,
          mustMention: [
            ...new Set([...slot.a, ...slot.b].flatMap((r) => r.summary.golden!.mustMentionMissed)),
          ],
          appName: any.appName,
          windowTitle: any.windowTitle,
          startOffsetMs: any.startOffsetMs,
          endOffsetMs: any.endOffsetMs,
          a: slot.a,
          b: slot.b,
          equivA,
          equivB,
          delta: equivA !== null && equivB !== null ? equivB - equivA : null,
          hardFailChanged:
            slot.a.length > 0 && slot.b.length > 0 && anyHardFail(slot.a) !== anyHardFail(slot.b),
          mentionFlipped,
        }
      })

    return {
      fixture,
      activities,
      unmatched,
      a: perRunAggregate(
        aScores.map((s) => s.score),
        aScores.length,
      ),
      b: perRunAggregate(
        bScores.map((s) => s.score),
        bScores.length,
      ),
    }
  })
}

export function reviewFirst(fixtures: FixtureComparison[]): ActivityComparison[] {
  return fixtures
    .flatMap((f) => f.activities)
    .filter((x) => x.hardFailChanged || x.mentionFlipped.length > 0 || bigDelta(x.delta))
    .sort((x, y) => Math.abs(y.delta ?? 0) - Math.abs(x.delta ?? 0))
}

function overall(arm: Arm, fixtures: Set<string>): Aggregate | null {
  return perRunAggregate(
    arm.reports.flatMap((r) => r.fixtures.filter((f) => fixtures.has(f.fixture))),
    arm.reports.length,
  )
}

const judged = (fixtures: FixtureComparison[]): boolean =>
  fixtures.some((f) => f.activities.some((x) => x.equivA !== null || x.equivB !== null))

function armHeader(arm: Arm): string[] {
  const lines = [`## Arm ${arm.name}`, '']
  arm.reports.forEach((r, i) => {
    const models = [...new Set(r.fixtures.map((f) => f.model || '-'))].join(', ')
    lines.push(
      `- ${arm.runIds[i]}: ${r.label ? `label ${r.label} · ` : ''}git ${gitLabel(r)} · ` +
        `pipeline ${r.pipeline ?? '(unknown)'}` +
        (r.maxSnapshots !== undefined ? ` · max ${r.maxSnapshots} snapshots` : '') +
        ` · ${models} · judge ${r.judgeModel ?? 'none'}`,
    )
  })
  lines.push('')
  return lines
}

function deltaPct(a: number | null, b: number | null): string {
  if (a === null || b === null) return '—'
  const d = (b - a) * 100
  return `${d > 0 ? '+' : ''}${d.toFixed(0)} pt`
}

function deltaNum(a: number | null, b: number | null, digits = 2): string {
  if (a === null || b === null) return '—'
  const d = b - a
  return `${d > 0 ? '+' : ''}${d.toFixed(digits)}`
}

function metricRow(
  name: string,
  a: Aggregate | null,
  b: Aggregate | null,
  withEquiv: boolean,
): string {
  const cols: string[] = [name]
  if (withEquiv) {
    cols.push(
      fmt(a?.equivalence ?? null),
      fmt(b?.equivalence ?? null),
      deltaNum(a?.equivalence ?? null, b?.equivalence ?? null),
    )
  }
  cols.push(
    pct(a?.mustMention ?? null),
    pct(b?.mustMention ?? null),
    deltaPct(a?.mustMention ?? null, b?.mustMention ?? null),
    a ? fmt(a.hardFails, 1) : '—',
    b ? fmt(b.hardFails, 1) : '—',
    deltaNum(a?.hardFails ?? null, b?.hardFails ?? null, 1),
    pct(a?.detPassRate ?? null),
    pct(b?.detPassRate ?? null),
    deltaPct(a?.detPassRate ?? null, b?.detPassRate ?? null),
    pct(a?.segCoverage ?? null),
    pct(b?.segCoverage ?? null),
    deltaPct(a?.segCoverage ?? null, b?.segCoverage ?? null),
    usd(a?.costUsd ?? null),
    usd(b?.costUsd ?? null),
    deltaNum(a?.costUsd ?? null, b?.costUsd ?? null, 4),
  )
  return `| ${cols.join(' | ')} |`
}

function runLine(side: string, r: RunSummary): string {
  const notes: string[] = []
  if (r.summary.golden?.equivalence != null)
    notes.push(`equiv ${fmt(r.summary.golden.equivalence)}`)
  if (r.summary.golden?.mustMentionMissed.length) {
    notes.push(`missed: ${r.summary.golden.mustMentionMissed.join('; ')}`)
  }
  const hard =
    r.summary.deterministic?.checks.filter((c) => !c.passed && c.severity === 'hard') ?? []
  if (hard.length) notes.push(`hard: ${hard.map((c) => c.id).join(', ')}`)
  if (r.summary.summaryModel.startsWith('heuristic:')) notes.push(r.summary.summaryModel)
  const note = notes.length ? ` (${notes.join(' · ')})` : ''
  return `${side} ${r.runId}${note}: ${r.summary.summary || '(empty)'}`
}

export function renderCompareMarkdown(a: Arm, b: Arm, fixtures: FixtureComparison[]): string {
  const withEquiv = judged(fixtures)
  const lines: string[] = [`# Compare — ${a.name} vs ${b.name}`, '']
  lines.push(...armHeader(a), ...armHeader(b))

  lines.push('## Metrics (per run)', '')
  const head = ['Fixture']
  if (withEquiv) head.push('Equiv A', 'B', 'Δ')
  head.push(
    'Mention% A',
    'B',
    'Δ',
    'Hard fails A',
    'B',
    'Δ',
    'Det pass% A',
    'B',
    'Δ',
    'Seg% A',
    'B',
    'Δ',
    'Cost A',
    'B',
    'Δ',
  )
  lines.push(`| ${head.join(' | ')} |`)
  lines.push(
    `|---|${head
      .slice(1)
      .map(() => '--:')
      .join('|')}|`,
  )
  for (const f of fixtures) lines.push(metricRow(f.fixture, f.a, f.b, withEquiv))
  const shared = new Set(fixtures.filter((f) => f.a && f.b).map((f) => f.fixture))
  lines.push(
    metricRow(
      `**overall** (${shared.size} shared)`,
      overall(a, shared),
      overall(b, shared),
      withEquiv,
    ),
  )
  lines.push('')

  const flagged = reviewFirst(fixtures)
  lines.push('## Review first', '')
  if (flagged.length === 0) lines.push('(nothing flagged)')
  for (const x of flagged) {
    const why: string[] = []
    if (bigDelta(x.delta)) {
      why.push(`equiv ${fmt(x.equivA)} → ${fmt(x.equivB)} (${deltaNum(x.equivA, x.equivB)})`)
    }
    if (x.hardFailChanged)
      why.push(`hard-fail ${anyHardFail(x.a) ? 'yes' : 'no'} → ${anyHardFail(x.b) ? 'yes' : 'no'}`)
    if (x.mentionFlipped.length) why.push(`flipped: ${x.mentionFlipped.join('; ')}`)
    lines.push(`- ${x.fixture} #${x.goldenIndex} [${x.appName}] ${why.join(' · ')}`)
  }
  lines.push('')

  lines.push('## Worksheet', '')
  for (const f of fixtures) {
    lines.push(`## ${f.fixture}`, '')
    for (const x of f.activities) {
      const range = `${formatOffset(x.startOffsetMs)}–${formatOffset(x.endOffsetMs)}`
      const title = x.windowTitle ? ` — ${x.windowTitle}` : ''
      lines.push(`### ${f.fixture} #${x.goldenIndex} [${range}] ${x.appName}${title}`)
      lines.push(`golden: ${x.golden}`)
      for (const r of x.a) lines.push(runLine(a.name, r))
      if (x.a.length === 0) lines.push(`${a.name}: (no activity matched this block)`)
      for (const r of x.b) lines.push(runLine(b.name, r))
      if (x.b.length === 0) lines.push(`${b.name}: (no activity matched this block)`)
      lines.push('')
    }
    const unmatched = [
      ...f.unmatched.a.map((r) => runLine(a.name, r)),
      ...f.unmatched.b.map((r) => runLine(b.name, r)),
    ]
    if (unmatched.length) {
      lines.push(`### ${f.fixture} — unmatched activities`)
      lines.push(...unmatched, '')
    }
  }
  return lines.join('\n')
}
