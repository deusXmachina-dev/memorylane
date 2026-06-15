import * as fs from 'fs'
import { splitMarkdownBlocks } from './markdown-blocks'
import type {
  GoldenSighting,
  GoldenVerdict,
  NewSighting,
  TaskFixtureActivity,
  TaskGolden,
} from './task-types'

/**
 * The golden for a task-mining fixture is a single hand-editable Markdown file
 * (`golden.md`), built by LABELING the miner's output. Each `## ` block is one
 * sighting with a `Verdict:` line you set to `keep` (legit task) or `reject`
 * (stupid). `eval-tasks --label` appends fresh candidates as `Verdict: ?` blocks;
 * you flip each `?` to keep/reject.
 *
 * Format (one `## ` block per sighting, blocks separated by `---`):
 *
 *   # Golden tasks — 2026-06-10
 *
 *   ## Submit expense report
 *   Verdict: keep
 *   Apps: Google Chrome, Preview
 *   Activities: a1, a2, a3
 *
 *   Downloaded receipts, filled the Concur form, submitted.
 *
 *   ---
 *
 *   ## "Research" — actually idle browsing
 *   Verdict: reject
 *   Activities: b1, b2
 *
 *   Not a task; the miner shouldn't surface this.
 *
 * `Verdict: ?` (or omitted on an appended candidate) = unreviewed: parked, not
 * scored, but it suppresses re-appending the same sighting. A hand-authored block
 * with no Verdict line defaults to `keep`. A commented day reference is appended
 * by the scaffold and ignored on parse.
 */

const HEADER_RE = /^##\s+(.+?)\s*$/
const VERDICT_RE = /^\s*Verdict:\s*(.*)$/i
const APPS_RE = /^\s*Apps:\s*(.*)$/i
const ACTIVITIES_RE = /^\s*Activities:\s*(.*)$/i

function splitList(s: string): string[] {
  return s
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
}

function parseVerdict(raw: string | null, hasVerdictLine: boolean): GoldenVerdict {
  if (!hasVerdictLine) return 'keep' // hand-authored block with no Verdict line
  const v = (raw ?? '').trim().toLowerCase()
  if (v === 'keep' || v === 'yes' || v === 'y' || v === '+') return 'keep'
  if (v === 'reject' || v === 'no' || v === 'n' || v === '-') return 'reject'
  return 'unreviewed' // '?', blank, or anything else
}

function offsetToHhmm(offsetMin: number): string {
  const m = ((offsetMin % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/**
 * Scaffolds golden.md for an exported day: instructions + a commented
 * chronological reference of every activity. Candidates are populated by
 * `eval-tasks --label`; you can also hand-author `## ` blocks.
 */
export function renderTaskGoldenMd(fixture: string, activities: TaskFixtureActivity[]): string {
  const sorted = [...activities].sort((a, b) => a.offsetMin - b.offsetMin)

  const lines: string[] = []
  lines.push(`# Golden tasks — ${fixture}`)
  lines.push('')
  lines.push('<!-- Build this by labeling the miner. Run:')
  lines.push(`       npm run eval-tasks -- --fixtures ${fixture} --label`)
  lines.push('     It appends each found sighting as a `## ` block with `Verdict: ?`.')
  lines.push('     Set each Verdict to `keep` (legit task) or `reject` (stupid), then')
  lines.push('     re-run without --label to score. You can also hand-author blocks:')
  lines.push('       ## <title>')
  lines.push('       Verdict: keep')
  lines.push('       Apps: <apps>')
  lines.push('       Activities: <ids>')
  lines.push('       <description>')
  lines.push('     The day reference below lists every activity id. -->')
  lines.push('')

  lines.push('<!-- THE DAY — chronological reference of every activity id.')
  for (const a of sorted) {
    const title = a.windowTitle ? ` — ${a.windowTitle}` : ''
    const sum = a.summary.replace(/\s+/g, ' ').slice(0, 100)
    lines.push(`  ${a.id}  ${offsetToHhmm(a.offsetMin)} [${a.app}${title}]  ${sum}`)
  }
  lines.push('-->')
  lines.push('')

  return lines.join('\n')
}

/** Renders detected sightings as unreviewed `## ` blocks to append for labeling. */
export function renderLabelBlocks(sightings: NewSighting[]): string {
  const lines: string[] = []
  for (const s of sightings) {
    lines.push(`## ${s.title}`)
    lines.push('Verdict: ?')
    lines.push(`Apps: ${s.apps.join(', ')}`)
    lines.push(`Activities: ${s.activityIds.join(', ')}`)
    lines.push('')
    if (s.description.trim()) lines.push(s.description.trim())
    lines.push('')
    lines.push('---')
    lines.push('')
  }
  return lines.join('\n')
}

/** Parses golden.md into labeled sightings. Lenient on whitespace. */
export function parseTaskGoldenMd(text: string): TaskGolden {
  const sightings: GoldenSighting[] = []
  for (const block of splitMarkdownBlocks(text, HEADER_RE)) {
    const headerMatch = block[0].match(HEADER_RE)
    if (!headerMatch) continue
    const title = headerMatch[1].trim()

    let apps: string[] = []
    let activityIds: string[] = []
    let verdictRaw: string | null = null
    let hasVerdictLine = false
    const descLines: string[] = []
    for (let i = 1; i < block.length; i++) {
      const line = block[i]
      const verdictM = line.match(VERDICT_RE)
      const appsM = line.match(APPS_RE)
      const actM = line.match(ACTIVITIES_RE)
      if (verdictM) {
        verdictRaw = verdictM[1]
        hasVerdictLine = true
      } else if (appsM) {
        apps = splitList(appsM[1])
      } else if (actM) {
        activityIds = splitList(actM[1])
      } else if (line.trim() === '---') {
        break
      } else {
        descLines.push(line)
      }
    }
    if (activityIds.length === 0) continue // un-edited scaffold / placeholder block

    sightings.push({
      title,
      description: descLines.join('\n').trim(),
      apps,
      activityIds,
      verdict: parseVerdict(verdictRaw, hasVerdictLine),
    })
  }

  return { sightings }
}

export function loadTaskGoldenMd(filePath: string): TaskGolden | null {
  if (!fs.existsSync(filePath)) return null
  return parseTaskGoldenMd(fs.readFileSync(filePath, 'utf8'))
}
