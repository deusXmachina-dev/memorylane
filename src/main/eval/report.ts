import * as fs from 'fs'
import * as path from 'path'
import { formatOffset } from './golden-md'
import { num as fmt, pct, usd, cell } from './format'
import type { EvalReport, FixtureScore, ScoredSummary } from './types'

/** Renders an EvalReport into a findings-style Markdown scorecard + raw JSON. */

/**
 * The model label for a variant, surfacing model-chain fallback: when the model
 * that actually produced the summaries differs from the one requested (e.g. a
 * snapshot-only model requested under the `auto`/`video` pipeline falls through
 * to the next video-capable model), show `requested → actual` so the row isn't
 * silently attributed to a model that never ran.
 */
function modelLabel(f: FixtureScore): string {
  const requested = f.model || '-'
  const actual = [...new Set(f.summaries.map((s) => s.summaryModel).filter(Boolean))]
  if (actual.length === 0 || (actual.length === 1 && actual[0] === f.model)) return requested
  return `${requested} → ${actual.join(' / ')}`
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
  lines.push('| Fixture | Model | Acts | Det pass% | Hard fails | Seg% | Equiv | Cost (USD) |')
  lines.push('|---|---|--:|--:|--:|--:|--:|--:|')
  for (const f of report.fixtures) {
    const seg = f.segmentation ? pct(f.segmentation.coverage) : '—'
    lines.push(
      `| ${f.fixture} | ${modelLabel(f)} | ${f.summaries.length} | ` +
        `${pct(f.detPassRate)} | ${f.hardFails} | ` +
        `${seg} | ${fmt(f.avgEquivalence, 2)} | ${usd(f.costUsd)} |`,
    )
  }
  lines.push('')
  if (report.fixtures.some((f) => f.costUsd != null)) {
    lines.push(
      '> Cost is the **summarizer** (production) spend per run. Eval-time judge cost is separate.',
    )
    lines.push('')
  }

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
      const eq = s.golden?.equivalence != null ? `equiv ${fmt(s.golden.equivalence, 2)}` : 'equiv —'
      const det = s.deterministic?.hardFails ? `, ${s.deterministic.hardFails} hard-fail(s)` : ''
      lines.push(`- **[${dur}s ${s.appName}]** ${eq}${det}`)
      lines.push(`  - ${s.summary || '_(empty)_'}`)
      if (s.golden) {
        lines.push(`  - golden #${s.golden.index}: ${s.golden.summary || '_(empty)_'}`)
      }
      const failed = s.deterministic?.checks.filter((ch) => !ch.passed && ch.detail) ?? []
      if (failed.length) {
        lines.push(`  - checks: ${failed.map((ch) => `${ch.id} (${ch.detail})`).join('; ')}`)
      }
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Side-by-side view for A/B runs: pivots the report so each activity shows the
 * golden target with every variant's summary + scores beneath it, instead of one
 * separate section per variant. Returns null when there's nothing to compare
 * (every fixture has a single variant). The variant is the model label today;
 * the same pivot serves prompt variants once those run in one report.
 */
export function renderComparisonMarkdown(report: EvalReport): string | null {
  const byFixture = new Map<string, FixtureScore[]>()
  for (const f of report.fixtures) {
    const arr = byFixture.get(f.fixture) ?? []
    arr.push(f)
    byFixture.set(f.fixture, arr)
  }
  // Worth a side-by-side when there are multiple variants to compare, OR when a
  // golden exists (so even a single model is shown next to its target).
  const multiVariant = [...byFixture.values()].some((v) => v.length > 1)
  const hasGolden = report.fixtures.some((f) => f.summaries.some((s) => s.golden))
  if (!multiVariant && !hasGolden) return null

  const lines: string[] = []
  lines.push(`# Activity-Summary Comparison — ${report.generatedAt}`)
  lines.push('')
  lines.push(`- Vendor: ${report.vendor}`)
  lines.push(`- Judge: ${report.judgeModel ?? '(none — deterministic only)'}`)
  lines.push('')

  for (const [fixture, scores] of byFixture) {
    lines.push(`## ${fixture}`)
    lines.push('')

    // Per-variant rollup.
    lines.push('| Variant | Acts | Det pass% | Hard fails | Seg% | Equiv | Cost (USD) |')
    lines.push('|---|--:|--:|--:|--:|--:|--:|')
    for (const s of scores) {
      const seg = s.segmentation ? pct(s.segmentation.coverage) : '—'
      lines.push(
        `| ${modelLabel(s)} | ${s.summaries.length} | ${pct(s.detPassRate)} | ` +
          `${s.hardFails} | ${seg} | ${fmt(s.avgEquivalence, 2)} | ` +
          `${usd(s.costUsd)} |`,
      )
    }
    lines.push('')

    // Align activities across variants. Golden index is the stable key when the
    // activity matched a block; otherwise bucket by start second (segmentation is
    // deterministic across variants, so same-slot activities share a start).
    interface Slot {
      order: number
      app: string
      title?: string
      startMs: number
      endMs: number
      golden?: string
      goldenIndex?: number
      byVariant: Map<string, ScoredSummary>
    }
    const slots = new Map<string, Slot>()
    for (const s of scores) {
      for (const sum of s.summaries) {
        const key = sum.golden ? `g${sum.golden.index}` : `t${Math.round(sum.startOffsetMs / 1000)}`
        let slot = slots.get(key)
        if (!slot) {
          slot = {
            order: sum.startOffsetMs,
            app: sum.appName,
            title: sum.windowTitle || undefined,
            startMs: sum.startOffsetMs,
            endMs: sum.endOffsetMs,
            golden: sum.golden?.summary,
            goldenIndex: sum.golden?.index,
            byVariant: new Map(),
          }
          slots.set(key, slot)
        }
        slot.byVariant.set(s.model, sum)
      }
    }

    // One row per activity; golden + each variant are columns, so the summaries
    // sit literally side by side. Score line (bold) sits above the text via <br>.
    lines.push(`| Activity | golden | ${scores.map((s) => s.model || '-').join(' | ')} |`)
    lines.push(`|---|---|${scores.map(() => '---').join('|')}|`)
    for (const slot of [...slots.values()].sort((a, b) => a.order - b.order)) {
      const range = `${formatOffset(slot.startMs)}–${formatOffset(slot.endMs)}`
      const head = `**[${range}]**<br>${cell(slot.app + (slot.title ? ` — ${slot.title}` : ''))}`
      const goldenCell = slot.golden
        ? `${slot.goldenIndex ? `**#${slot.goldenIndex}**<br>` : ''}${cell(slot.golden)}`
        : '—'
      const variantCells = scores.map((s) => {
        const sum = slot.byVariant.get(s.model)
        if (!sum) return '_(none)_'
        const parts = [
          sum.golden?.equivalence != null ? `equiv ${fmt(sum.golden.equivalence, 2)}` : 'equiv —',
        ]
        if (sum.deterministic?.hardFails) parts.push(`${sum.deterministic.hardFails} hard-fail(s)`)
        // Note the model that actually ran if it differs from the requested one.
        const ran = sum.summaryModel && sum.summaryModel !== s.model ? ` → ${sum.summaryModel}` : ''
        return `**${parts.join(' · ')}${ran}**<br>${cell(sum.summary || '_(empty)_')}`
      })
      lines.push(`| ${head} | ${goldenCell} | ${variantCells.join(' | ')} |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Writes one run into its own timestamped folder under `resultsDir`:
 *   <resultsDir>/<run-id>/{report.json, report.md, comparison.md}
 * so each run's artifacts stay together instead of sharing a flat directory.
 */
export function writeReport(
  resultsDir: string,
  report: EvalReport,
): { runDir: string; jsonPath: string; mdPath: string; comparePath: string | null } {
  const runId = report.generatedAt.replace(/[:.]/g, '-')
  const runDir = path.join(resultsDir, runId)
  fs.mkdirSync(runDir, { recursive: true })

  const jsonPath = path.join(runDir, 'report.json')
  const mdPath = path.join(runDir, 'report.md')
  fs.writeFileSync(jsonPath, renderJson(report), 'utf8')
  fs.writeFileSync(mdPath, renderMarkdown(report), 'utf8')

  const comparison = renderComparisonMarkdown(report)
  let comparePath: string | null = null
  if (comparison) {
    comparePath = path.join(runDir, 'comparison.md')
    fs.writeFileSync(comparePath, comparison, 'utf8')
  }
  return { runDir, jsonPath, mdPath, comparePath }
}
