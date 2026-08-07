#!/usr/bin/env npx tsx
/**
 * DEU-205 PII scrubber bake-off: recall per category, false positives on clean
 * controls, and latency for each candidate stack (regex libs, NER models,
 * layered combos). Optionally replays a real dev-DB day for FP realism.
 *
 * Usage:
 *   npm run eval-pii-scrub                              # full matrix on the fixture
 *   npm run eval-pii-scrub -- --scrubber current,rampart
 *   npm run eval-pii-scrub -- --dev-db-day 2026-07-03
 *   npm run eval-pii-scrub -- --out evals/findings/pii-scrub-eval.md
 *
 * Reports with --dev-db-day contain real PII — write them to the private
 * evals repo, never to findings/.
 */

import * as fs from 'fs'
import * as path from 'path'
import Database from 'better-sqlite3'
import { scrubPII } from '../src/shared/sanitize'
import { getDefaultDbPath, getModelCacheDir } from '../src/main/utils/paths'
import {
  PII_PLANTS,
  CLEAN_CONTROLS,
  KEEP_CATEGORIES,
  GAP_CATEGORIES,
  type PiiCategory,
  type PiiPlant,
} from '../src/main/eval/pii-fixture'

const CATEGORIES: PiiCategory[] = [
  'name',
  'email',
  'phone',
  'address',
  'ssn',
  'dob',
  'credit_card',
  'bank',
  'employee_id',
  'username',
  'password',
  'secret',
  'tfn',
  'medicare',
  'ird',
  'nhi',
]

const CATEGORY_LABELS: Record<PiiCategory, string> = {
  name: 'name',
  email: 'email',
  phone: 'phone',
  address: 'addr',
  ssn: 'ssn',
  dob: 'dob',
  credit_card: 'card',
  bank: 'bank',
  employee_id: 'emp',
  username: 'user',
  password: 'pass',
  secret: 'secret',
  tfn: 'tfn',
  medicare: 'mcare',
  ird: 'ird',
  nhi: 'nhi',
}

const NER_MODELS: Record<string, { id: string; dtype: string }> = {
  rampart: { id: 'nationaldesignstudio/rampart', dtype: 'q4' },
  piiranha: { id: 'onnx-community/piiranha-v1-detect-personal-information-ONNX', dtype: 'int8' },
}

const ALL_SCRUBBERS = [
  'current',
  'remove-pii',
  'redact-pii',
  'rampart',
  'piiranha',
  'rampart+current',
  'piiranha+current',
  'remove-pii+rampart',
  'redact-pii+rampart',
]

const LABEL_PLACEHOLDERS: Record<string, string> = {
  GIVENNAME: '[redacted name]',
  SURNAME: '[redacted name]',
  MIDDLENAME: '[redacted name]',
  FIRSTNAME: '[redacted name]',
  LASTNAME: '[redacted name]',
  NAME: '[redacted name]',
  PER: '[redacted name]',
  PERSON: '[redacted name]',
  EMAIL: '[email address]',
  TELEPHONENUM: '[phone number]',
  PHONENUMBER: '[phone number]',
  PHONE: '[phone number]',
  STREET: '[redacted address]',
  STREETADDRESS: '[redacted address]',
  BUILDINGNUM: '[redacted address]',
  CITY: '[redacted address]',
  STATE: '[redacted address]',
  ZIPCODE: '[redacted address]',
  POSTCODE: '[redacted address]',
  SOCIALNUM: '[redacted personal id]',
  SOCIALSECURITYNUMBER: '[redacted personal id]',
  SSN: '[redacted personal id]',
  IDCARDNUM: '[redacted personal id]',
  DRIVERLICENSENUM: '[redacted personal id]',
  DRIVERSLICENSE: '[redacted personal id]',
  PASSPORTNUM: '[redacted personal id]',
  PASSPORTNUMBER: '[redacted personal id]',
  TAXNUM: '[redacted personal id]',
  TAXID: '[redacted personal id]',
  GOVERNMENTID: '[redacted personal id]',
  NATIONALID: '[redacted personal id]',
  CREDITCARDNUMBER: '[redacted payment card]',
  CREDITCARD: '[redacted payment card]',
  ACCOUNTNUM: '[redacted bank account]',
  IBAN: '[redacted bank account]',
  DATEOFBIRTH: '[redacted date of birth]',
  DOB: '[redacted date of birth]',
  USERNAME: '[redacted username]',
  PASSWORD: '[redacted password]',
  SECRET: '[redacted secret]',
  APIKEY: '[redacted secret]',
  TOKEN: '[redacted secret]',
}

const SKIP_TYPES = new Set(['URL'])

interface Scrubber {
  name: string
  init(): Promise<void>
  scrub(text: string): Promise<string>
  loadMs: number
  footprint(): string
  unmappedLabels?: Set<string>
}

interface RawTok {
  entity: string
  score: number
  index: number
  word: string
  start: number | null
  end: number | null
}

interface Span {
  start: number
  end: number
  type: string
  score: number
}

const WINDOW_CHARS = 1800
const WINDOW_OVERLAP = 200

class NerScrubber implements Scrubber {
  name: string
  loadMs = 0
  unmappedLabels = new Set<string>()
  private modelId: string
  private dtype: string
  private threshold: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipe: any = null

  constructor(name: string, modelId: string, dtype: string, threshold: number) {
    this.name = name
    this.modelId = modelId
    this.dtype = dtype
    this.threshold = threshold
  }

  async init(): Promise<void> {
    if (this.pipe) return
    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = getModelCacheDir()
    const t0 = performance.now()
    this.pipe = await pipeline('token-classification', this.modelId, { dtype: this.dtype })
    this.loadMs = Math.round(performance.now() - t0)
  }

  footprint(): string {
    const dir = path.join(getModelCacheDir(), ...this.modelId.split('/'))
    const mb = dirSizeMb(dir)
    return mb === null ? '?' : `${mb.toFixed(0)}MB model`
  }

  async scrub(text: string): Promise<string> {
    const spans: Span[] = []
    for (const { offset, slice } of windows(text)) {
      const raw = (await this.pipe(slice)) as RawTok[]
      for (const span of this.buildSpans(slice, raw)) {
        spans.push({ ...span, start: span.start + offset, end: span.end + offset })
      }
    }
    const kept = spans.filter((s) => !SKIP_TYPES.has(normalizeLabel(s.type)))
    const resolved = mergeSpans(kept).map((s) => ({
      ...s,
      placeholder: this.placeholderFor(s.type),
    }))
    return replaceSpans(text, resolved)
  }

  private placeholderFor(type: string): string {
    const norm = normalizeLabel(type)
    const mapped = LABEL_PLACEHOLDERS[norm]
    if (mapped) return mapped
    this.unmappedLabels.add(type)
    return `[redacted ${norm.toLowerCase()}]`
  }

  private buildSpans(text: string, toks: RawTok[]): Span[] {
    const lower = text.toLowerCase()
    const spans: Span[] = []
    let cur: (Span & { lastIndex: number }) | null = null
    let cursor = 0

    for (const tok of toks) {
      if (tok.score < this.threshold) continue
      const type = tok.entity.replace(/^[BI]-/, '')
      let start = typeof tok.start === 'number' ? tok.start : null
      let end = typeof tok.end === 'number' ? tok.end : null
      if (start === null || end === null) {
        const located = locateToken(lower, cursor, tok.word)
        if (!located) continue
        start = located.start
        end = located.end
      }
      cursor = Math.max(cursor, end)

      if (cur && cur.type === type && tok.index === cur.lastIndex + 1) {
        cur.end = Math.max(cur.end, end)
        cur.score = Math.max(cur.score, tok.score)
        cur.lastIndex = tok.index
      } else {
        if (cur) spans.push({ start: cur.start, end: cur.end, type: cur.type, score: cur.score })
        cur = { start, end, type, score: tok.score, lastIndex: tok.index }
      }
    }
    if (cur) spans.push({ start: cur.start, end: cur.end, type: cur.type, score: cur.score })
    return spans
  }
}

function normalizeLabel(type: string): string {
  return type.toUpperCase().replace(/[^A-Z]/g, '')
}

function locateToken(
  lowerText: string,
  cursor: number,
  word: string,
): { start: number; end: number } | null {
  const piece = word.replace(/^##/, '').replace(/▁/g, ' ').trim().toLowerCase()
  if (!piece) return null
  const at = lowerText.indexOf(piece, cursor)
  if (at === -1) return null
  return { start: at, end: at + piece.length }
}

function* windows(text: string): Generator<{ offset: number; slice: string }> {
  if (text.length <= WINDOW_CHARS) {
    yield { offset: 0, slice: text }
    return
  }
  let offset = 0
  while (offset < text.length) {
    yield { offset, slice: text.slice(offset, offset + WINDOW_CHARS) }
    if (offset + WINDOW_CHARS >= text.length) break
    offset += WINDOW_CHARS - WINDOW_OVERLAP
  }
}

function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: Span[] = []
  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (last && span.start < last.end) {
      last.end = Math.max(last.end, span.end)
      if (span.score > last.score) last.type = span.type
    } else {
      merged.push({ ...span })
    }
  }
  return merged
}

function replaceSpans(text: string, spans: (Span & { placeholder: string })[]): string {
  let out = text
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, span.start) + span.placeholder + out.slice(span.end)
  }
  return out
}

function makeSimpleScrubber(
  name: string,
  load: () => Promise<(text: string) => string>,
  footprint: () => string,
): Scrubber {
  let fn: ((text: string) => string) | null = null
  const scrubber: Scrubber = {
    name,
    loadMs: 0,
    async init() {
      if (fn) return
      const t0 = performance.now()
      fn = await load()
      scrubber.loadMs = Math.round(performance.now() - t0)
    },
    async scrub(text: string) {
      if (!fn) throw new Error(`${name} not initialized`)
      return fn(text)
    },
    footprint,
  }
  return scrubber
}

function pkgFootprint(pkgs: string[]): string {
  const total = pkgs
    .map((p) => dirSizeMb(path.resolve('node_modules', p)) ?? 0)
    .reduce((a, b) => a + b, 0)
  return `${total.toFixed(1)}MB deps`
}

function dirSizeMb(dir: string): number | null {
  if (!fs.existsSync(dir)) return null
  let bytes = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop() as string
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) bytes += fs.statSync(full).size
    }
  }
  return bytes / 1024 / 1024
}

class ChainScrubber implements Scrubber {
  name: string
  private parts: Scrubber[]

  constructor(name: string, parts: Scrubber[]) {
    this.name = name
    this.parts = parts
  }

  get loadMs(): number {
    return this.parts.reduce((a, p) => a + p.loadMs, 0)
  }

  async init(): Promise<void> {
    for (const p of this.parts) await p.init()
  }

  async scrub(text: string): Promise<string> {
    let out = text
    for (const p of this.parts) out = await p.scrub(out)
    return out
  }

  footprint(): string {
    return this.parts.map((p) => p.footprint()).join(' + ')
  }
}

function buildScrubber(spec: string, threshold: number, cache: Map<string, Scrubber>): Scrubber {
  const parts = spec.split('+')
  if (parts.length > 1) {
    return new ChainScrubber(
      spec,
      parts.map((p) => buildScrubber(p, threshold, cache)),
    )
  }
  const existing = cache.get(spec)
  if (existing) return existing

  const [base, thrStr] = spec.split('@')
  let scrubber: Scrubber
  if (spec === 'current') {
    scrubber = makeSimpleScrubber(
      'current',
      async () => scrubPII,
      () => '0MB (built-in)',
    )
  } else if (spec === 'remove-pii') {
    scrubber = makeSimpleScrubber(
      'remove-pii',
      async () => {
        const mod = await import('@coffeeandfun/remove-pii')
        return (text: string) => mod.removePII(text)
      },
      () => pkgFootprint(['@coffeeandfun/remove-pii']),
    )
  } else if (spec === 'redact-pii') {
    scrubber = makeSimpleScrubber(
      'redact-pii',
      async () => {
        const mod = await import('redact-pii')
        const redactor = new mod.SyncRedactor()
        return (text: string) => redactor.redact(text)
      },
      () => pkgFootprint(['redact-pii', '@google-cloud/dlp', 'lodash']),
    )
  } else if (NER_MODELS[base]) {
    const m = NER_MODELS[base]
    scrubber = new NerScrubber(spec, m.id, m.dtype, thrStr ? parseFloat(thrStr) : threshold)
  } else {
    throw new Error(`Unknown scrubber "${spec}". Known: ${ALL_SCRUBBERS.join(', ')}`)
  }
  cache.set(spec, scrubber)
  return scrubber
}

const normalizeForLeak = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function leaked(output: string, pii: string): boolean {
  const normOut = normalizeForLeak(output)
  const normPii = normalizeForLeak(pii)
  const window = Math.min(12, normPii.length)
  for (let i = 0; i + window <= normPii.length; i++) {
    if (normOut.includes(normPii.slice(i, i + window))) return true
  }
  return false
}

/**
 * Did the text around the planted value survive? A scrubber that deletes its
 * surroundings removes the PII too, so a leak-only metric scores destruction as
 * a pass. Checks the 20 chars adjacent to the plant on each side — the tail of
 * what precedes it, the head of what follows — since that is what a mis-anchored
 * span eats first.
 */
function damaged(text: string, pii: string, output: string): boolean {
  const segments = text.split(pii)
  for (let i = 0; i < segments.length; i++) {
    const trimmed = segments[i].trim()
    if (trimmed.length < 4) continue
    const windows: string[] = []
    if (i < segments.length - 1) windows.push(trimmed.slice(-20))
    if (i > 0) windows.push(trimmed.slice(0, 20))
    for (const w of windows) {
      if (w.trim().length >= 4 && !output.includes(w)) return true
    }
  }
  return false
}

interface CategoryResult {
  caught: number
  total: number
  missed: PiiPlant[]
}

interface FixtureResult {
  name: string
  byCategory: Record<PiiCategory, CategoryResult>
  caughtTotal: number
  plantTotal: number
  falsePositives: { id: string; kind: string; before: string; after: string }[]
  wronglyRemoved: PiiPlant[]
  damagedPlants: PiiPlant[]
  knownGaps: number
  msPerText: number
  loadMs: number
  footprint: string
  unmappedLabels: string[]
}

async function runOnFixture(scrubber: Scrubber): Promise<FixtureResult> {
  const byCategory = {} as Record<PiiCategory, CategoryResult>
  for (const c of CATEGORIES) byCategory[c] = { caught: 0, total: 0, missed: [] }

  const wronglyRemoved: PiiPlant[] = []
  const damagedPlants: PiiPlant[] = []
  let knownGaps = 0

  const t0 = performance.now()
  for (const p of PII_PLANTS) {
    const out = await scrubber.scrub(p.text)

    if (KEEP_CATEGORIES.has(p.category)) {
      byCategory[p.category].total++
      if (leaked(out, p.pii)) byCategory[p.category].caught++
      else wronglyRemoved.push(p)
      continue
    }

    if (GAP_CATEGORIES.has(p.category)) {
      knownGaps++
      continue
    }

    byCategory[p.category].total++
    if (leaked(out, p.pii)) byCategory[p.category].missed.push(p)
    else byCategory[p.category].caught++
    if (damaged(p.text, p.pii, out)) damagedPlants.push(p)
  }

  const falsePositives: FixtureResult['falsePositives'] = []
  for (const c of CLEAN_CONTROLS) {
    const out = await scrubber.scrub(c.text)
    if (out !== c.text) falsePositives.push({ id: c.id, kind: c.kind, before: c.text, after: out })
  }
  const elapsed = performance.now() - t0

  const caughtTotal = CATEGORIES.reduce((a, c) => a + byCategory[c].caught, 0)
  return {
    name: scrubber.name,
    byCategory,
    caughtTotal,
    plantTotal: CATEGORIES.reduce((a, c) => a + byCategory[c].total, 0),
    falsePositives,
    wronglyRemoved,
    damagedPlants,
    knownGaps,
    msPerText: elapsed / (PII_PLANTS.length + CLEAN_CONTROLS.length),
    loadMs: scrubber.loadMs,
    footprint: scrubber.footprint(),
    unmappedLabels: [...(scrubber.unmappedLabels ?? [])],
  }
}

interface DbResult {
  name: string
  altered: number
  total: number
  samples: { before: string; after: string }[]
}

async function runOnDbTexts(scrubber: Scrubber, texts: string[]): Promise<DbResult> {
  let altered = 0
  const samples: DbResult['samples'] = []
  for (const text of texts) {
    const out = await scrubber.scrub(text)
    if (out !== text) {
      altered++
      if (samples.length < 12) samples.push(diffSample(text, out))
    }
  }
  return { name: scrubber.name, altered, total: texts.length, samples }
}

function diffSample(before: string, after: string): { before: string; after: string } {
  let i = 0
  while (i < before.length && i < after.length && before[i] === after[i]) i++
  const from = Math.max(0, i - 40)
  const clip = (s: string): string =>
    (from > 0 ? '…' : '') +
    s.slice(from, from + 120).replace(/\n/g, '⏎ ') +
    (s.length > from + 120 ? '…' : '')
  return { before: clip(before), after: clip(after) }
}

function loadDayTexts(dbPath: string, day: string, includeOcr: boolean, cap: number): string[] {
  const start = new Date(`${day}T00:00:00`).getTime()
  const end = start + 24 * 60 * 60 * 1000
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const rows = db
      .prepare(
        'SELECT window_title, summary, ocr_text FROM activities WHERE start_timestamp >= ? AND start_timestamp < ?',
      )
      .all(start, end) as { window_title: string; summary: string; ocr_text: string }[]
    const texts = new Set<string>()
    for (const r of rows) {
      if (r.window_title?.trim()) texts.add(r.window_title)
      if (r.summary?.trim()) texts.add(r.summary)
      if (includeOcr && r.ocr_text?.trim()) texts.add(r.ocr_text.slice(0, 6000))
    }
    return [...texts].slice(0, cap)
  } finally {
    db.close()
  }
}

interface CliArgs {
  scrubbers: string[]
  threshold: number
  devDbDay: string | null
  dbPath: string
  includeOcr: boolean
  out: string | null
  maxDbTexts: number
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const a: CliArgs = {
    scrubbers: ALL_SCRUBBERS,
    threshold: 0.5,
    devDbDay: null,
    dbPath: getDefaultDbPath(),
    includeOcr: false,
    out: null,
    maxDbTexts: 400,
  }
  for (let i = 0; i < args.length; i++) {
    const next = args[i + 1]
    switch (args[i]) {
      case '--scrubber':
        if (next) {
          a.scrubbers = next === 'all' ? ALL_SCRUBBERS : next.split(',')
          i++
        }
        break
      case '--threshold':
        if (next) {
          a.threshold = parseFloat(next)
          i++
        }
        break
      case '--dev-db-day':
        if (next) {
          a.devDbDay = next
          i++
        }
        break
      case '--db-path':
        if (next) {
          a.dbPath = path.resolve(next)
          i++
        }
        break
      case '--include-ocr':
        a.includeOcr = true
        break
      case '--max-db-texts':
        if (next) {
          a.maxDbTexts = parseInt(next, 10)
          i++
        }
        break
      case '--out':
        if (next) {
          a.out = path.resolve(next)
          i++
        }
        break
      default:
        console.error(`Unknown argument: ${args[i]}`)
        process.exit(1)
    }
  }
  return a
}

function renderReport(results: FixtureResult[], dbResults: DbResult[], args: CliArgs): string {
  const lines: string[] = []
  lines.push('## Recall per category (caught/planted)')
  lines.push('')
  const header = [
    'scrubber',
    ...CATEGORIES.map((c) => CATEGORY_LABELS[c]),
    'total',
    'FP',
    'ms/text',
  ]
  lines.push(`| ${header.join(' | ')} |`)
  lines.push(`|${header.map(() => '---').join('|')}|`)
  for (const r of results) {
    const cells = CATEGORIES.map((c) => {
      const { caught, total } = r.byCategory[c]
      return caught === total ? `**${caught}/${total}**` : `${caught}/${total}`
    })
    lines.push(
      `| ${r.name} | ${cells.join(' | ')} | ${r.caughtTotal}/${r.plantTotal} | ${r.falsePositives.length} | ${r.msPerText.toFixed(1)} |`,
    )
  }
  lines.push('')

  lines.push('## Preservation')
  lines.push('')
  lines.push(
    'A leak count alone scores deletion as success. `damaged` counts plants where text around the ' +
      'planted value did not survive; `wrongly removed` counts names and emails the policy keeps ' +
      'but the scrubber took. Both are defects.',
  )
  lines.push('')
  lines.push('| scrubber | damaged | wrongly removed | known gaps (not scored) |')
  lines.push('|---|---|---|---|')
  for (const r of results) {
    lines.push(
      `| ${r.name} | ${r.damagedPlants.length} | ${r.wronglyRemoved.length} | ${r.knownGaps} |`,
    )
  }
  lines.push('')

  const withDamage = results.filter((r) => r.damagedPlants.length || r.wronglyRemoved.length)
  if (withDamage.length) {
    for (const r of withDamage) {
      lines.push(`### ${r.name} — preservation defects`)
      lines.push('')
      for (const p of r.damagedPlants) {
        lines.push(`- damaged \`${p.id}\`: \`${p.text}\``)
      }
      for (const p of r.wronglyRemoved) {
        lines.push(`- wrongly removed \`${p.id}\` (${p.category}): \`${p.pii}\``)
      }
      lines.push('')
    }
  }

  lines.push('## Load time and footprint')
  lines.push('')
  lines.push('| scrubber | load ms | footprint |')
  lines.push('|---|---|---|')
  for (const r of results) lines.push(`| ${r.name} | ${r.loadMs} | ${r.footprint} |`)
  lines.push('')

  const withFps = results.filter((r) => r.falsePositives.length > 0)
  if (withFps.length) {
    lines.push('## False positives on clean controls')
    lines.push('')
    for (const r of withFps) {
      lines.push(`### ${r.name} (${r.falsePositives.length})`)
      lines.push('')
      for (const fp of r.falsePositives) {
        lines.push(`- \`${fp.id}\` (${fp.kind}): \`${fp.before}\` → \`${fp.after}\``)
      }
      lines.push('')
    }
  }

  const withMisses = results.filter((r) => r.caughtTotal < r.plantTotal)
  if (withMisses.length) {
    lines.push('## Missed plants')
    lines.push('')
    for (const r of withMisses) {
      const missed = CATEGORIES.flatMap((c) => r.byCategory[c].missed)
      lines.push(`### ${r.name} (${missed.length})`)
      lines.push('')
      lines.push(missed.map((m) => `\`${m.id}\``).join(', '))
      lines.push('')
    }
  }

  const withUnmapped = results.filter((r) => r.unmappedLabels.length > 0)
  if (withUnmapped.length) {
    lines.push('## Unmapped NER labels seen')
    lines.push('')
    for (const r of withUnmapped) lines.push(`- ${r.name}: ${r.unmappedLabels.join(', ')}`)
    lines.push('')
  }

  if (dbResults.length) {
    lines.push(
      `## Dev-DB day ${args.devDbDay} (${dbResults[0]?.total} texts, no ground truth — eyeball TP vs FP)`,
    )
    lines.push('')
    lines.push('| scrubber | altered |')
    lines.push('|---|---|')
    for (const r of dbResults) lines.push(`| ${r.name} | ${r.altered}/${r.total} |`)
    lines.push('')
    for (const r of dbResults) {
      if (!r.samples.length) continue
      lines.push(`### ${r.name} samples`)
      lines.push('')
      for (const s of r.samples) {
        lines.push(`- \`${s.before}\``)
        lines.push(`  → \`${s.after}\``)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}

async function main(): Promise<void> {
  const args = parseArgs()
  const cache = new Map<string, Scrubber>()
  const results: FixtureResult[] = []
  const dbResults: DbResult[] = []

  let dbTexts: string[] = []
  if (args.devDbDay) {
    dbTexts = loadDayTexts(args.dbPath, args.devDbDay, args.includeOcr, args.maxDbTexts)
    console.log(`Loaded ${dbTexts.length} texts from ${args.devDbDay} (${args.dbPath})`)
  }

  for (const spec of args.scrubbers) {
    const scrubber = buildScrubber(spec, args.threshold, cache)
    process.stdout.write(`[${spec}] init… `)
    await scrubber.init()
    process.stdout.write(`${scrubber.loadMs}ms. fixture… `)
    results.push(await runOnFixture(scrubber))
    if (dbTexts.length) {
      process.stdout.write('dev-db… ')
      dbResults.push(await runOnDbTexts(scrubber, dbTexts))
    }
    console.log('done')
  }

  const report = renderReport(results, dbResults, args)
  console.log('')
  console.log(report)
  if (args.out) {
    fs.writeFileSync(args.out, report + '\n', 'utf8')
    console.log(`\nWritten to ${args.out}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
