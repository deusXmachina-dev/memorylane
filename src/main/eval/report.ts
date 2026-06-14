import * as fs from 'fs'
import * as path from 'path'
import { RUBRIC_DIMENSIONS } from './rubric'
import type { CellResult, EvalRun } from './types'

/**
 * Renders an EvalRun into a findings-style Markdown scorecard plus the raw JSON.
 * When a baseline run is supplied, adds a regression view: per-cell deltas and a
 * summary-level side-by-side for cells whose text changed.
 */

export function cellKey(cell: {
  fixture: string
  videoModel: string
  snapshotModel: string
  promptVariant: string
}): string {
  return `${cell.fixture} | ${cell.videoModel || '-'}/${cell.snapshotModel || '-'} | ${cell.promptVariant}`
}

function fmt(n: number | null, digits = 2): string {
  return n === null || Number.isNaN(n) ? '—' : n.toFixed(digits)
}

function fmtDelta(curr: number | null, prev: number | null, digits = 2): string {
  if (curr === null || prev === null) return '—'
  const d = curr - prev
  const sign = d > 0 ? '+' : ''
  return `${sign}${d.toFixed(digits)}`
}

export function renderJson(run: EvalRun): string {
  return JSON.stringify(run, null, 2)
}

export function renderMarkdown(run: EvalRun, baseline: EvalRun | null = null): string {
  const lines: string[] = []
  lines.push(`# Activity-Summary Eval — ${run.runId}`)
  lines.push('')
  lines.push(`- Generated: ${run.generatedAt}`)
  lines.push(`- Vendor: ${run.vendor}`)
  lines.push(
    `- Judge: ${run.judgeModel ?? '(none — deterministic only)'}${run.judgeTextOnly ? ' (text-only)' : ''}`,
  )
  lines.push(`- Cells: ${run.cells.length}`)
  if (baseline) lines.push(`- Baseline: ${baseline.runId}`)
  lines.push('')

  // Scorecard
  lines.push('## Scorecard')
  lines.push('')
  lines.push(
    '| Fixture | Models | Prompt | Acts | Rubric/10 | Det pass% | Hard fails | Golden | Tokens (in/out) | Cost $ | p50 dur |',
  )
  lines.push('|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|')
  for (const c of run.cells) {
    const tokens = `${c.cost.summaryTokensIn + c.cost.judgeTokensIn}/${c.cost.summaryTokensOut + c.cost.judgeTokensOut}`
    lines.push(
      `| ${c.fixture} | ${c.videoModel || '-'}/${c.snapshotModel || '-'} | ${c.promptVariant} | ${c.aggregate.count} | ` +
        `${fmt(c.aggregate.avgRubric10)} | ${fmt(c.aggregate.detPassRate * 100, 0)}% | ${c.aggregate.hardFails} | ` +
        `${fmt(c.aggregate.avgGoldenScore, 3)} | ${tokens} | ${fmt(c.cost.usd, 4)} | ${(c.aggregate.p50DurationMs / 1000).toFixed(0)}s |`,
    )
  }
  lines.push('')

  // Per-dimension breakdown
  if (run.judgeModel) {
    lines.push('## Rubric dimensions (avg per cell)')
    lines.push('')
    const header = ['Cell', ...RUBRIC_DIMENSIONS.map((d) => d.key)]
    lines.push(`| ${header.join(' | ')} |`)
    lines.push(`|${header.map(() => '---').join('|')}|`)
    for (const c of run.cells) {
      const dimAvgs = RUBRIC_DIMENSIONS.map((d) => {
        const vals = c.summaries
          .map((s) => s.rubric?.dimensions.find((x) => x.key === d.key)?.score)
          .filter((n): n is number => typeof n === 'number')
        return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—'
      })
      lines.push(`| ${cellKey(c)} | ${dimAvgs.join(' | ')} |`)
    }
    lines.push('')
  }

  // Per-summary detail
  lines.push('## Summaries')
  lines.push('')
  for (const c of run.cells) {
    lines.push(`### ${cellKey(c)}`)
    if (c.golden) {
      if (c.golden.unmatchedGoldenIds.length) {
        lines.push(
          `> ⚠ Unmatched goldens (possible segmentation regression): ${c.golden.unmatchedGoldenIds.join(', ')}`,
        )
      }
      if (c.golden.unmatchedActivityIds.length) {
        lines.push(`> ⚠ Activities with no golden: ${c.golden.unmatchedActivityIds.length}`)
      }
    }
    lines.push('')
    for (const s of c.summaries) {
      const dur = (s.durationMs / 1000).toFixed(0)
      const r = s.rubric
        ? `rubric ${fmt(s.rubric.aggregate10)}${s.rubric.capped ? ' (capped)' : ''}`
        : 'rubric —'
      const det = s.deterministic.hardFails ? `, ${s.deterministic.hardFails} hard-fail(s)` : ''
      lines.push(`- **[${dur}s ${s.appName}]** ${r}${det}`)
      lines.push(`  - ${s.summary || '_(empty)_'}`)
      const failed = s.deterministic.checks.filter((ch) => !ch.passed && ch.detail)
      if (failed.length) {
        lines.push(`  - checks: ${failed.map((ch) => `${ch.id} (${ch.detail})`).join('; ')}`)
      }
      if (s.rubric?.flaggedClaims.length) {
        lines.push(`  - flagged: ${s.rubric.flaggedClaims.join('; ')}`)
      }
    }
    lines.push('')
  }

  if (baseline) {
    lines.push(...renderBaselineDiff(run, baseline))
  }

  return lines.join('\n')
}

function renderBaselineDiff(run: EvalRun, baseline: EvalRun): string[] {
  const lines: string[] = []
  const baseByKey = new Map(baseline.cells.map((c) => [cellKey(c), c]))

  lines.push(`## Δ vs baseline (${baseline.runId})`)
  lines.push('')
  lines.push('| Cell | ΔRubric/10 | ΔDet pass% | ΔGolden | ΔCost $ |')
  lines.push('|---|--:|--:|--:|--:|')
  for (const c of run.cells) {
    const b = baseByKey.get(cellKey(c))
    if (!b) {
      lines.push(`| ${cellKey(c)} | _new_ | _new_ | _new_ | _new_ |`)
      continue
    }
    lines.push(
      `| ${cellKey(c)} | ${fmtDelta(c.aggregate.avgRubric10, b.aggregate.avgRubric10)} | ` +
        `${fmtDelta(c.aggregate.detPassRate * 100, b.aggregate.detPassRate * 100, 0)}% | ` +
        `${fmtDelta(c.aggregate.avgGoldenScore, b.aggregate.avgGoldenScore, 3)} | ` +
        `${fmtDelta(c.cost.usd, b.cost.usd, 4)} |`,
    )
  }
  lines.push('')

  // Summary-level side-by-side where text changed.
  lines.push('### Changed summaries')
  lines.push('')
  let any = false
  for (const c of run.cells) {
    const b = baseByKey.get(cellKey(c))
    if (!b) continue
    const pairs = matchSummaries(c, b)
    for (const [curr, prev] of pairs) {
      if (!prev || curr.summary === prev.summary) continue
      any = true
      lines.push(`- **${cellKey(c)}** — [${(curr.durationMs / 1000).toFixed(0)}s ${curr.appName}]`)
      lines.push(`  - old: ${prev.summary || '_(empty)_'}`)
      lines.push(`  - new: ${curr.summary || '_(empty)_'}`)
    }
  }
  if (!any) lines.push('_No summary text changed._')
  lines.push('')
  return lines
}

type SummaryOf = CellResult['summaries'][number]

/** Match current↔baseline summaries by goldenId, falling back to start-offset order. */
function matchSummaries(curr: CellResult, prev: CellResult): Array<[SummaryOf, SummaryOf | null]> {
  const out: Array<[SummaryOf, SummaryOf | null]> = []
  const prevByGolden = new Map(prev.summaries.filter((s) => s.goldenId).map((s) => [s.goldenId, s]))
  const usedPrev = new Set<string>()

  const currSorted = [...curr.summaries].sort((a, b) => a.startOffsetMs - b.startOffsetMs)
  const prevSorted = [...prev.summaries].sort((a, b) => a.startOffsetMs - b.startOffsetMs)

  for (let i = 0; i < currSorted.length; i++) {
    const s = currSorted[i]
    if (s.goldenId && prevByGolden.has(s.goldenId)) {
      const match = prevByGolden.get(s.goldenId)!
      usedPrev.add(match.activityId)
      out.push([s, match])
      continue
    }
    const fallback = prevSorted[i] && !usedPrev.has(prevSorted[i].activityId) ? prevSorted[i] : null
    if (fallback) usedPrev.add(fallback.activityId)
    out.push([s, fallback])
  }
  return out
}

// --------------------------------------------------------------------------
// Result IO + baseline pointer
// --------------------------------------------------------------------------

export function writeRun(resultsDir: string, run: EvalRun): { jsonPath: string; mdPath: string } {
  fs.mkdirSync(resultsDir, { recursive: true })
  const safeId = run.runId.replace(/[:]/g, '-')
  const jsonPath = path.join(resultsDir, `${safeId}.json`)
  const mdPath = path.join(resultsDir, `${safeId}.md`)
  fs.writeFileSync(jsonPath, renderJson(run), 'utf8')
  return { jsonPath, mdPath }
}

export function readRun(resultsDir: string, runId: string): EvalRun | null {
  const safeId = runId.replace(/[:]/g, '-')
  const p = path.join(resultsDir, `${safeId}.json`)
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf8')) as EvalRun
}

export function readBaselinePointer(resultsDir: string): string | null {
  const p = path.join(resultsDir, 'baseline.json')
  if (!fs.existsSync(p)) return null
  try {
    return (JSON.parse(fs.readFileSync(p, 'utf8')) as { runId?: string }).runId ?? null
  } catch {
    return null
  }
}

export function writeBaselinePointer(resultsDir: string, runId: string): void {
  fs.mkdirSync(resultsDir, { recursive: true })
  fs.writeFileSync(
    path.join(resultsDir, 'baseline.json'),
    JSON.stringify({ runId }, null, 2),
    'utf8',
  )
}

export function latestRunId(resultsDir: string): string | null {
  if (!fs.existsSync(resultsDir)) return null
  const ids = fs
    .readdirSync(resultsDir)
    .filter((f) => f.endsWith('.json') && f !== 'baseline.json')
    .map((f) => f.replace(/\.json$/, ''))
    .sort()
  return ids.length ? ids[ids.length - 1] : null
}
