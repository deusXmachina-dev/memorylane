/**
 * Deterministic PII scrub — the regex backstop behind the LLM's de-identification
 * (the model handles names; this catches emails, phone numbers, long id runs,
 * and secret-shaped values). Typed slot names instead of [redacted] so the
 * recipe still says what goes there. Conservative by design: must never mangle
 * prose like "4 steps" or dates, and every quantifier is bounded so matching
 * stays linear.
 */

const EMAIL =
  /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,4}\.[A-Za-z]{2,24}\b/g
// Capped at realistic phone length; digit count and date shape re-checked in the replacer.
const PHONE_LIKE = /\+?\d[\d\s().-]{5,22}\d/g
const LONG_DIGITS = /\b\d{5,}\b/g
// 2026-07-19, 2026/7/9, 19.07.2026, 19. 7. 2026, and year ranges like 2024-2025.
const DATE_LIKE =
  /^\d{4}([-/.])\d{1,2}(?:\1\d{1,2})?$|^\d{1,2}([./-])\s?\d{1,2}\2\s?\d{4}$|^\d{4}-\d{4}$/
const DOTTED_QUAD = /^\d{1,3}(?:\.\d{1,3}){3}$/

const SECRET_TOKEN =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,})\b/g
const LABELED_SECRET =
  /\b([A-Za-z0-9_.-]*(?:secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key)\b\s*[:=]\s*)(?!\[)(\S{6,})/gi
const LABELED_PASSWORD = /\b((?:password|passwd|passphrase|pwd)\s*[:=]\s*)(?!\[)(\S{4,})/gi
const PASSWORD_LINE =
  /\b((?:password|passwd|passphrase)\s*\n\s*)(?!\[)((?=\S*[\d#!@$%^&*+=])\S{6,})/gi
const LABELED_DOB =
  /\b((?:date of birth|birth ?date|dob|born(?: on)?)\s*[:=]?\s*(?:(?:to|is)\s+)?)((?:\d{1,2}[/. -]){2}\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.? \d{1,2},? \d{4})/gi
const LABELED_EMPLOYEE_ID =
  /\b((?:employee|badge|worker|emp)\s*(?:id|no|number)?\.?\s*[:#]?\s*)((?=[A-Za-z0-9-]*\d{4})[A-Za-z0-9-]{4,})/gi

const countDigits = (s: string): number => s.match(/\d/g)?.length ?? 0

// A digit run touching letters through [\w-] is an identifier (UUID segment,
// timestamp filename, tracking/ticket id), not a phone or bare id.
const isIdentifierBound = (s: string, start: number, end: number): boolean => {
  for (let i = start - 1; i >= 0 && /[\w-]/.test(s[i]); i--) {
    if (/[A-Za-z_]/.test(s[i])) return true
  }
  for (let j = end; j < s.length && /[\w-]/.test(s[j]); j++) {
    if (/[A-Za-z_]/.test(s[j])) return true
  }
  return false
}

const scrubCore = (text: string): string =>
  text
    .replace(SECRET_TOKEN, '[redacted secret]')
    .replace(LABELED_SECRET, '$1[redacted secret]')
    .replace(LABELED_PASSWORD, '$1[redacted password]')
    .replace(PASSWORD_LINE, '$1[redacted password]')
    .replace(LABELED_DOB, '$1[redacted date of birth]')
    .replace(LABELED_EMPLOYEE_ID, '$1[redacted employee id]')
    .replace(PHONE_LIKE, (m, offset: number, s: string) => {
      // Digit-and-space-only runs need 9+ digits so spaced amounts like
      // "1 000 000" survive; real spaced phones (CZ "777 123 456") still hit 9.
      const minDigits = /^[\d\s]+$/.test(m) ? 9 : 7
      if (countDigits(m) < minDigits || DATE_LIKE.test(m) || DOTTED_QUAD.test(m)) return m
      return isIdentifierBound(s, offset, offset + m.length) ? m : '[phone number]'
    })
    .replace(LONG_DIGITS, (m, offset: number, s: string) =>
      isIdentifierBound(s, offset, offset + m.length) ? m : '[id number]',
    )

export function scrubPII(text: string): string {
  return scrubCore(text.replace(EMAIL, '[email address]'))
}

export function scrubPromptPII(text: string): string {
  return scrubCore(text)
}
