import * as fs from 'fs'
import * as path from 'path'
import { num, pct, usd } from './format'
import type { TaskEvalReport } from './task-types'

/** Renders a TaskEvalReport into a findings-style Markdown scorecard. */
export function renderTaskMarkdown(report: TaskEvalReport): string {
  const lines: string[] = []
  lines.push(`# Task-Mining Eval — ${report.generatedAt}`)
  lines.push('')
  lines.push(`- Vendor: ${report.vendor}`)
  lines.push(`- Judge: ${report.judgeModel ?? '(none)'}`)
  lines.push('')
  lines.push('## Scorecard')
  lines.push('')
  lines.push(
    '| Fixture | Model | Found (keep) | Recall | Reject reproduced | New | Grounding | Equiv | Cost |',
  )
  lines.push('|---|---|--:|--:|--:|--:|--:|--:|--:|')
  for (const f of report.fixtures) {
    const model = f.mode === 'scan-only' ? `${f.model} (scan)` : f.model
    lines.push(
      `| ${f.fixture} | ${model} | ${f.foundCount}/${f.positiveCount} | ${pct(f.recall)} | ` +
        `${f.rejectedReproducedCount}/${f.negativeCount} | ${f.newCount} | ` +
        `${pct(f.avgGroundingRecall)} | ${num(f.avgEquivalence)} | ${usd(f.costUsd)} |`,
    )
  }
  lines.push('')
  lines.push('## Detail')
  for (const f of report.fixtures) {
    lines.push('')
    lines.push(`### ${f.fixture} | ${f.model}${f.mode === 'scan-only' ? ' (scan-only)' : ''}`)
    lines.push(
      `> ${f.detectedCount} sighting(s) detected; ${f.foundCount}/${f.positiveCount} keep tasks found; ` +
        `${f.rejectedReproducedCount} reject(s) reproduced; ${f.newCount} new`,
    )
    if (f.rejectedReproducedTitles.length)
      lines.push(`> ⚠ reproduced rejects: ${f.rejectedReproducedTitles.join('; ')}`)
    if (f.bundledSightingIds.length)
      lines.push(`> ⚠ ${f.bundledSightingIds.length} sighting(s) bundled multiple keep tasks`)
    for (const g of f.goldenScores) {
      const mark = g.found ? '✅' : '❌'
      lines.push('')
      lines.push(`- ${mark} **${g.goldenTitle}** → ${g.matchedTitle ?? '(missed)'}`)
      lines.push(
        `  - grounding: recall ${pct(g.grounding.recall)}, precision ${pct(g.grounding.precision)}, ` +
          `IoU ${pct(g.grounding.iou)} (${g.grounding.matchedIds.length} ids)`,
      )
      if (g.equivalence != null) {
        lines.push(`  - judge: equiv ${num(g.equivalence)}`)
      }
    }
    if (f.newSightings.length) {
      lines.push('')
      lines.push('New (unlabeled — thumbs these with `--label`):')
      for (const n of f.newSightings) lines.push(`  - ${n.title} (${n.activityIds.length} ids)`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * Writes a task-mining run as a timestamped `<stamp>.json` + `<stamp>.md` pair
 * under `resultsDir`. Returns the Markdown path.
 */
export function writeTaskReport(resultsDir: string, report: TaskEvalReport): string {
  fs.mkdirSync(resultsDir, { recursive: true })
  const stamp = report.generatedAt.replace(/[:.]/g, '-')
  fs.writeFileSync(path.join(resultsDir, `${stamp}.json`), JSON.stringify(report, null, 2), 'utf8')
  const mdPath = path.join(resultsDir, `${stamp}.md`)
  fs.writeFileSync(mdPath, renderTaskMarkdown(report), 'utf8')
  return mdPath
}
