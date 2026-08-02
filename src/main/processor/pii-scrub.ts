import log from '@main/utils/logger'
import { configureModelEnv } from '@main/processor/embedding'
import { scrubPII } from '@/shared/sanitize'

const MODEL_NAME = 'nationaldesignstudio/rampart'
const MODEL_DTYPE = 'q4'
const SCORE_THRESHOLD = 0.5
const WINDOW_CHARS = 1800
const WINDOW_OVERLAP = 200

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
  STREETNAME: '[redacted address]',
  STREETADDRESS: '[redacted address]',
  SECONDARYADDRESS: '[redacted address]',
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
  PASSPORT: '[redacted personal id]',
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
  ROUTINGNUM: '[redacted bank account]',
  ROUTINGNUMBER: '[redacted bank account]',
  DATEOFBIRTH: '[redacted date of birth]',
  DOB: '[redacted date of birth]',
  USERNAME: '[redacted username]',
  PASSWORD: '[redacted password]',
  SECRET: '[redacted secret]',
  APIKEY: '[redacted secret]',
  TOKEN: '[redacted secret]',
}

const SKIP_TYPES = new Set(['URL', 'BUILDINGNUMBER'])

export interface NerToken {
  entity: string
  score: number
  index: number
  word: string
  start: number | null
  end: number | null
}

export type NerPipeline = (text: string) => Promise<NerToken[]>

interface Span {
  start: number
  end: number
  type: string
  score: number
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

function buildSpans(text: string, toks: NerToken[], threshold: number): Span[] {
  const lower = text.toLowerCase()
  const spans: Span[] = []
  let cur: (Span & { lastIndex: number }) | null = null
  let cursor = 0

  for (const tok of toks) {
    if (tok.score < threshold) continue
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

function isAllowed(spanText: string, allow: string[]): boolean {
  const norm = spanText.trim().toLowerCase()
  if (!norm) return false
  return allow.some((entry) => {
    const e = entry.trim().toLowerCase()
    return e === norm || e.split(/\s+/).includes(norm)
  })
}

export class PiiScrubber {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipe: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private loading: Promise<any> | null = null

  constructor(pipe?: NerPipeline) {
    this.pipe = pipe ?? null
  }

  private async ensurePipe(): Promise<NerPipeline> {
    if (this.pipe) return this.pipe
    if (!this.loading) {
      this.loading = (async () => {
        configureModelEnv()
        const t0 = Date.now()
        const { pipeline } = await import('@huggingface/transformers')
        const pipe = await pipeline('token-classification', MODEL_NAME, { dtype: MODEL_DTYPE })
        log.debug(`[PiiScrubber] loaded ${MODEL_NAME} in ${Date.now() - t0}ms`)
        return pipe
      })()
      this.loading.catch(() => {
        this.loading = null
      })
    }
    this.pipe = await this.loading
    return this.pipe
  }

  async scrubBatch(texts: string[], allow: string[] = []): Promise<string[]> {
    if (texts.length === 0) return []
    const pipe = await this.ensurePipe()
    const t0 = Date.now()
    let spanCount = 0
    let charCount = 0
    const out: string[] = []
    for (const text of texts) {
      charCount += text.length
      if (!text.trim()) {
        out.push(text)
        continue
      }
      const spans: Span[] = []
      for (const { offset, slice } of windows(text)) {
        const raw = await pipe(slice)
        for (const span of buildSpans(slice, raw, SCORE_THRESHOLD)) {
          spans.push({ ...span, start: span.start + offset, end: span.end + offset })
        }
      }
      const kept = spans.filter(
        (s) =>
          !SKIP_TYPES.has(normalizeLabel(s.type)) && !isAllowed(text.slice(s.start, s.end), allow),
      )
      spanCount += kept.length
      const resolved = mergeSpans(kept).map((s) => ({
        ...s,
        placeholder: LABEL_PLACEHOLDERS[normalizeLabel(s.type)] ?? '[redacted]',
      }))
      out.push(scrubPII(replaceSpans(text, resolved)))
    }
    log.debug(
      `[PiiScrubber] scrubBatch n=${texts.length} chars=${charCount} spans=${spanCount} ms=${Date.now() - t0}`,
    )
    return out
  }
}
