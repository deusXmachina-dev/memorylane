import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { scrubPII } from '../src/shared/sanitize'

const args = process.argv.slice(2)
const flag = (name: string, fallback?: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}

const inputPath = resolve(flag('in', 'scripts/pii-review-sample.txt') as string)
const outPath = flag('out')
const scrub = scrubPII

const raw = readFileSync(inputPath, 'utf8')

const tokenize = (s: string): string[] => s.match(/\[[^\]\n]+\]|\s+|[^\s[]+|\[/g) ?? []

function diff(a: string[], b: string[]): { kind: 'same' | 'del' | 'add'; text: string }[] {
  const n = a.length
  const m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const out: { kind: 'same' | 'del' | 'add'; text: string }[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'del', text: a[i++] })
    } else {
      out.push({ kind: 'add', text: b[j++] })
    }
  }
  while (i < n) out.push({ kind: 'del', text: a[i++] })
  while (j < m) out.push({ kind: 'add', text: b[j++] })
  return out
}

const lines: string[] = []
const say = (s = '') => lines.push(s)

const paragraphs = raw.split(/\n\s*\n/)
const tally = new Map<string, number>()
const changes: { before: string; after: string; context: string }[] = []

say('PII scrub review — scrubPII (names and emails kept by policy)')
say(`source: ${inputPath}`)
say('='.repeat(100))

for (const para of paragraphs) {
  if (!para.trim()) continue
  const cleaned = scrub(para)
  const parts = diff(tokenize(para), tokenize(cleaned))

  const before: string[] = []
  const after: string[] = []
  let pendingDel: string[] = []
  let pendingAdd: string[] = []
  const flush = () => {
    if (!pendingDel.length && !pendingAdd.length) return
    const b = pendingDel.join('').trim()
    const a = pendingAdd.join('').trim()
    if (b || a) {
      changes.push({ before: b, after: a, context: '' })
      for (const ph of a.match(/\[[^\]]+\]/g) ?? []) tally.set(ph, (tally.get(ph) ?? 0) + 1)
    }
    pendingDel = []
    pendingAdd = []
  }
  for (const p of parts) {
    if (p.kind === 'same') {
      flush()
      before.push(p.text)
      after.push(p.text)
    } else if (p.kind === 'del') {
      pendingDel.push(p.text)
      before.push(p.text)
    } else {
      pendingAdd.push(p.text)
      after.push(p.text)
    }
  }
  flush()

  say()
  say(cleaned.trim())
  say('-'.repeat(100))
}

say()
say('='.repeat(100))
say(`REPLACEMENTS (${changes.length})`)
say('='.repeat(100))
const width = Math.max(...changes.map((c) => c.before.length), 10)
for (const c of changes) {
  say(`  ${c.before.padEnd(width)}  ->  ${c.after}`)
}

say()
say('='.repeat(100))
say('TALLY')
say('='.repeat(100))
for (const [ph, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
  say(`  ${String(n).padStart(3)}x  ${ph}`)
}

say()
say('='.repeat(100))
say('SURVIVED — read this list and confirm nothing here should have been removed')
say('='.repeat(100))
const survivors = [
  ...new Set(
    (scrub(raw).match(/[A-Za-z0-9][A-Za-z0-9._%+@/-]{5,}/g) ?? []).filter(
      (t) => /\d/.test(t) && !t.startsWith('['),
    ),
  ),
]
for (const s of survivors) say(`  ${s}`)

const report = lines.join('\n')
if (outPath) {
  writeFileSync(resolve(outPath), report + '\n')
  console.log(`wrote ${outPath} (${changes.length} replacements, ${survivors.length} survivors)`)
} else {
  console.log(report)
}
