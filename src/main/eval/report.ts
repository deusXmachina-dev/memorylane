import * as fs from 'fs'
import * as path from 'path'
import type { EvalReport } from './types'

/** Renders an EvalReport into a findings-style Markdown scorecard + raw JSON. */

function fmt(n: number | null, digits = 2): string {
  return n === null || Number.isNaN(n) ? '—' : n.toFixed(digits)
}

export function renderJson(report: EvalReport): string {
  return JSON.stringify(report, null, 2)
}

export function renderMarkdown(report: EvalReport): string {
  const lines: string[] = []
  lines.push(`# Activity-Summary Eval — ${report.generatedAt}`)
  lines.push('')
  lines.push(`- Vendor: ${report.vendor}`)
  lines.push(`- Judge: ${report.judgeModel ?? '(none — deterministic only)'}`)
  lines.push('')

  // Scorecard
  lines.push('## Scorecard')
  lines.push('')
  lines.push('| Fixture | Model | Acts | Det pass% | Hard fails | Judge/10 | Seg% | Equiv |')
  lines.push('|---|---|--:|--:|--:|--:|--:|--:|')
  for (const f of report.fixtures) {
    const seg = f.segmentation ? `${fmt(f.segmentation.coverage * 100, 0)}%` : '—'
    lines.push(
      `| ${f.fixture} | ${f.model || '-'} | ${f.summaries.length} | ` +
        `${fmt(f.detPassRate * 100, 0)}% | ${f.hardFails} | ${fmt(f.avgJudge10)} | ` +
        `${seg} | ${fmt(f.avgEquivalence, 2)} |`,
    )
  }
  lines.push('')

  // Per-summary detail
  lines.push('## Summaries')
  lines.push('')
  for (const f of report.fixtures) {
    lines.push(`### ${f.fixture} | ${f.model || '-'}`)
    if (f.segmentation) {
      const seg = f.segmentation
      lines.push(
        `> Segmentation: ${seg.goldenCount - seg.unmatchedGoldenIndexes.length}/${seg.goldenCount} golden blocks matched` +
          (seg.unmatchedGoldenIndexes.length
            ? `; ⚠ missed/merged blocks: ${seg.unmatchedGoldenIndexes.join(', ')}`
            : '') +
          (seg.extraActivityCount
            ? `; ⚠ ${seg.extraActivityCount} extra activity(ies) (over-split)`
            : '') +
          (seg.expectedDropCount ? `; ${seg.expectedDropCount} expected drop(s)` : '') +
          (seg.dropViolationIndexes.length
            ? `; ⚠ kept ${seg.dropViolationIndexes.length} block(s) marked DROPPED: ${seg.dropViolationIndexes.join(', ')}`
            : ''),
      )
    }
    lines.push('')
    for (const s of f.summaries) {
      const dur = (s.durationMs / 1000).toFixed(0)
      const j = s.judge ? `judge ${fmt(s.judge.score10)}` : 'judge —'
      const eq = s.golden?.equivalence != null ? `, equiv ${fmt(s.golden.equivalence, 2)}` : ''
      const det = s.deterministic.hardFails ? `, ${s.deterministic.hardFails} hard-fail(s)` : ''
      lines.push(`- **[${dur}s ${s.appName}]** ${j}${eq}${det}`)
      lines.push(`  - ${s.summary || '_(empty)_'}`)
      if (s.golden) {
        lines.push(`  - golden #${s.golden.index}: ${s.golden.summary || '_(empty)_'}`)
      }
      const failed = s.deterministic.checks.filter((ch) => !ch.passed && ch.detail)
      if (failed.length) {
        lines.push(`  - checks: ${failed.map((ch) => `${ch.id} (${ch.detail})`).join('; ')}`)
      }
      if (s.judge?.flaggedClaims.length) {
        lines.push(`  - flagged: ${s.judge.flaggedClaims.join('; ')}`)
      }
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function writeReport(
  resultsDir: string,
  report: EvalReport,
): { jsonPath: string; mdPath: string } {
  fs.mkdirSync(resultsDir, { recursive: true })
  const safeId = report.generatedAt.replace(/[:.]/g, '-')
  const jsonPath = path.join(resultsDir, `${safeId}.json`)
  const mdPath = path.join(resultsDir, `${safeId}.md`)
  fs.writeFileSync(jsonPath, renderJson(report), 'utf8')
  fs.writeFileSync(mdPath, renderMarkdown(report), 'utf8')
  return { jsonPath, mdPath }
}
