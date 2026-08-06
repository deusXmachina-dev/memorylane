/**
 * Deterministic PII scrub for AU/NZ corpora.
 *
 * Policy: redact identifiers that carry no added value, keep what carries
 * semantic role. Names, emails and company identifiers (ABN/ACN/NZBN) stay —
 * they are how a sighting reads as client work rather than internal work.
 * Personal identifiers become a typed slot naming the class, so a recipe still
 * says what belongs there.
 *
 * Rules are claimed in table order over the original text; the first rule to
 * claim a span wins and later rules cannot re-match it. `keep` rules claim a
 * span precisely so a looser rule below cannot redact it.
 */

interface Rule {
  slot: string
  pattern: RegExp
  validate?: (value: string) => boolean
  bounded?: boolean
  keep?: boolean
}

const digitsOf = (s: string): string => s.replace(/\D/g, '')

const hasDigit = (s: string): boolean => /\d/.test(s)

const weightedSum = (digits: string, weights: readonly number[]): number =>
  weights.reduce((sum, w, i) => sum + w * (digits.charCodeAt(i) - 48), 0)

export const passesLuhn = (digits: string): boolean => {
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

export const passesTfn = (value: string): boolean => {
  const d = digitsOf(value)
  return d.length === 9 && weightedSum(d, [1, 4, 3, 7, 5, 8, 6, 9, 10]) % 11 === 0
}

export const passesAbn = (value: string): boolean => {
  const d = digitsOf(value)
  if (d.length !== 11) return false
  const adjusted = String(Number(d[0]) - 1) + d.slice(1)
  return weightedSum(adjusted, [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]) % 89 === 0
}

export const passesAcn = (value: string): boolean => {
  const d = digitsOf(value)
  if (d.length !== 9) return false
  const sum = weightedSum(d, [8, 7, 6, 5, 4, 3, 2, 1])
  return (10 - (sum % 10)) % 10 === Number(d[8])
}

export const passesMedicare = (value: string): boolean => {
  const d = digitsOf(value)
  if (d.length !== 10 && d.length !== 11) return false
  if (d[0] < '2' || d[0] > '6') return false
  return weightedSum(d, [1, 3, 7, 9, 1, 3, 7, 9]) % 10 === Number(d[8])
}

export const passesIrd = (value: string): boolean => {
  const d = digitsOf(value)
  if (d.length !== 8 && d.length !== 9) return false
  const n = Number(d)
  if (n < 10_000_000 || n > 200_000_000) return false
  const base = d.slice(0, -1).padStart(8, '0')
  const check = Number(d[d.length - 1])
  const calc = (weights: readonly number[]): number => {
    const rem = weightedSum(base, weights) % 11
    return rem === 0 ? 0 : 11 - rem
  }
  const first = calc([3, 2, 7, 6, 5, 4, 3, 2])
  if (first !== 10) return first === check
  return calc([7, 4, 3, 2, 5, 2, 7, 6]) === check
}

const NHI_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

export const passesNhi = (value: string): boolean => {
  const v = value.toUpperCase().replace(/\s/g, '')
  if (!/^[A-HJ-NP-Z]{3}\d{4}$/.test(v)) return false
  let sum = 0
  for (let i = 0; i < 6; i++) {
    const ch = v[i]
    const val = ch >= '0' && ch <= '9' ? Number(ch) : NHI_ALPHABET.indexOf(ch) + 1
    if (val <= 0 && !(ch >= '0' && ch <= '9')) return false
    sum += val * (7 - i)
  }
  const rem = sum % 11
  if (rem === 0) return false
  const check = 11 - rem
  return (check === 10 ? 0 : check) === Number(v[6])
}

const LABEL_SUFFIX =
  '\\)?\\s*(?:number|no|nr|#|declaration|form|details|record|is|reads|shows)?\\.?\\s*[:#=]?\\s*'
const labelled = (labels: string, value: string): RegExp =>
  new RegExp(`\\b(?:${labels})${LABEL_SUFFIX}(${value})`, 'gi')

const NUMERIC_VALUE = '\\d[\\d \\-]{5,22}\\d'
const ALNUM_VALUE =
  '[A-Za-z0-9][A-Za-z0-9-]*(?:[ ][A-Za-z0-9-]*\\d[A-Za-z0-9-]*){0,4}(?:[ ][A-Za-z]\\b)?'

const DATE_LIKE =
  /^\d{4}([-/.])\d{1,2}(?:\1\d{1,2})?$|^\d{1,2}([./-])\s?\d{1,2}\2\s?\d{4}$|^\d{4}-\d{4}$/
const DOTTED_QUAD = /^\d{1,3}(?:\.\d{1,3}){3}$/
const GROUPED_AMOUNT = /^\d{1,3}(?: \d{3})+$/

const RULES: Rule[] = [
  { slot: '', keep: true, pattern: /\b\d{2} ?\d{3} ?\d{3} ?\d{3}\b/g, validate: passesAbn },
  { slot: '', keep: true, pattern: labelled('abn|australian business number', NUMERIC_VALUE) },
  { slot: '', keep: true, pattern: /\b\d{3} ?\d{3} ?\d{3}\b/g, validate: passesAcn },
  { slot: '', keep: true, pattern: labelled('acn|australian company number', NUMERIC_VALUE) },
  { slot: '', keep: true, pattern: labelled('nzbn', NUMERIC_VALUE) },
  { slot: '', keep: true, pattern: /\bBSB:? ?\d{3}[- ]?\d{3}\b(?![- ]?\d)/gi },

  {
    slot: '[redacted secret]',
    pattern:
      /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,})\b/g,
  },
  {
    slot: '[redacted secret]',
    pattern:
      /\b[A-Za-z0-9_.-]*(?:secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key)\b\s*[:=]\s*(?!\[)(\S{6,})/gi,
  },
  {
    slot: '[redacted password]',
    pattern: /\b(?:password|passwd|passphrase|pwd|pass)\s*[:=]\s*(?!\[)(\S{4,})/gi,
  },
  {
    slot: '[redacted password]',
    pattern: /\b(?:password|passphrase)\s+(?!\[)((?=\S*[\d#!@$%^&*+=])\S{6,})/gi,
  },
  {
    slot: '[redacted password]',
    pattern: /\b(?:password|passwd|passphrase)\s*\n\s*(?!\[)((?=\S*[\d#!@$%^&*+=])\S{6,})/gi,
  },
  {
    slot: '[redacted date of birth]',
    pattern:
      /\b(?:date of birth|birth ?date|dob|born(?: on)?)\s*[:=]?\s*(?:(?:to|is)\s+)?((?:\d{1,2}[/. -]){2}\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.? \d{1,2},? \d{4})/gi,
  },
  {
    slot: '[redacted employee id]',
    pattern:
      /\b(?:employee|badge|worker|staff|emp)\s*(?:id|no|number)?\.?\s*[:#]?\s*((?=[A-Za-z0-9-]*\d{4})[A-Za-z0-9-]{4,})/gi,
  },

  { slot: '[bank account]', pattern: /\b\d{2}-\d{4}-\d{7}-\d{2,3}\b/g },
  { slot: '[bank account]', pattern: /\b\d{3}[- ]\d{3}[ ,/]+(\d{6,10})\b/g },
  {
    slot: '[bank account]',
    pattern: labelled(
      'bsb(?: and)?(?: account)?|bank account|account|acct|acc|a/c|routing|aba',
      NUMERIC_VALUE,
    ),
    validate: (v) => !GROUPED_AMOUNT.test(v.trim()),
  },
  { slot: '[bank account]', pattern: labelled('iban|swift|bic', ALNUM_VALUE), validate: hasDigit },

  {
    slot: '[medicare number]',
    pattern: /\b\d{4} ?\d{5} ?\d(?: ?\d)?\b/g,
    validate: passesMedicare,
  },
  { slot: '[medicare number]', pattern: labelled('medicare', NUMERIC_VALUE) },
  { slot: '[tax file number]', pattern: labelled('tfn|tax file', NUMERIC_VALUE) },
  { slot: '[ird number]', pattern: /\b\d{2,3}[- ]\d{3}[- ]\d{3}\b/g, validate: passesIrd },
  { slot: '[ird number]', pattern: labelled('ird', NUMERIC_VALUE) },
  { slot: '[ird number]', pattern: labelled('gst', NUMERIC_VALUE), validate: passesIrd },
  { slot: '[nhi number]', pattern: /\b[A-HJ-NP-Z]{3}\d{4}\b/g, validate: passesNhi },
  { slot: '[nhi number]', pattern: labelled('nhi', ALNUM_VALUE), validate: hasDigit },

  {
    slot: '[payment card]',
    bounded: true,
    pattern: /\b\d(?:[ -]?\d){12,18}\b/g,
    validate: (v) => {
      const d = digitsOf(v)
      return d.length >= 13 && d.length <= 19 && passesLuhn(d)
    },
  },
  { slot: '[id number]', pattern: /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g },
  { slot: '[id number]', pattern: labelled('ssn|social security|taxpayer id', NUMERIC_VALUE) },
  {
    slot: '[id number]',
    pattern: labelled(
      "passport|driver'?s?\\s*licen[cs]e|licen[cs]e|crn|customer reference|centrelink|visa grant|medicare provider",
      ALNUM_VALUE,
    ),
    validate: hasDigit,
  },

  {
    slot: '[phone number]',
    pattern: labelled('tel|telephone|phone|mobile|mob|cell|fax|direct line', NUMERIC_VALUE),
  },
  {
    slot: '[phone number]',
    bounded: true,
    pattern: /(?:\+6[14][ -]?\(?0?\)?[ -]?|\b0)[2-9](?:[ -]?\d){7,9}\b/g,
    validate: (v) => {
      const d = digitsOf(v)
      return d.length >= 9 && d.length <= 12 && !DATE_LIKE.test(v) && !DOTTED_QUAD.test(v)
    },
  },
  {
    slot: '[phone number]',
    bounded: true,
    pattern: /\+?\d[\d\s().-]{5,22}\d/g,
    validate: (v) => {
      if (/^[\d ]+$/.test(v)) return false
      const d = digitsOf(v)
      return d.length >= 7 && d.length <= 15 && !DATE_LIKE.test(v) && !DOTTED_QUAD.test(v)
    },
  },
]

const isIdentifierBound = (s: string, start: number, end: number): boolean => {
  for (let i = start - 1; i >= 0 && /[\w-]/.test(s[i]); i--) {
    if (/[A-Za-z_]/.test(s[i])) return true
  }
  for (let j = end; j < s.length && /[\w-]/.test(s[j]); j++) {
    if (/[A-Za-z_]/.test(s[j])) return true
  }
  return false
}

interface Claim {
  start: number
  end: number
  slot: string
  keep: boolean
}

export function scrubPII(text: string): string {
  if (!text) return text
  const claims: Claim[] = []
  const overlaps = (start: number, end: number): boolean =>
    claims.some((c) => start < c.end && end > c.start)

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = rule.pattern.exec(text)) !== null) {
      if (m[0] === '') {
        rule.pattern.lastIndex++
        continue
      }
      const matched = m[1] ?? m[0]
      const start = m[1] === undefined ? m.index : m.index + m[0].indexOf(m[1])
      const value = matched.replace(/[.,;:!?]+$/, '') || matched
      const end = start + value.length
      if (overlaps(start, end)) continue
      if (rule.validate && !rule.validate(value)) continue
      if (rule.bounded && isIdentifierBound(text, start, end)) continue
      claims.push({ start, end, slot: rule.slot, keep: rule.keep === true })
    }
  }

  claims.sort((a, b) => b.start - a.start)
  let out = text
  for (const c of claims) {
    if (c.keep) continue
    out = out.slice(0, c.start) + c.slot + out.slice(c.end)
  }
  return out
}
