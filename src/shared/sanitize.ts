/**
 * Deterministic PII scrub — the regex backstop behind the LLM's de-identification
 * (the model handles names; this catches emails, phone numbers, and long id runs).
 * Typed slot names instead of [redacted] so the recipe still says what goes there.
 * Conservative by design: must never mangle prose like "4 steps" or dates, and
 * every quantifier is bounded so matching stays linear.
 */

const EMAIL =
  /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,4}\.[A-Za-z]{2,24}\b/g
// Capped at realistic phone length; digit count and date shape re-checked in the replacer.
const PHONE_LIKE = /\+?\d[\d\s().-]{5,22}\d/g
const LONG_DIGITS = /\b\d{5,}\b/g
// 2026-07-19, 2026/7/9, 19.07.2026, 19. 7. 2026, and year ranges like 2024-2025.
const DATE_LIKE =
  /^\d{4}([-/.])\d{1,2}(?:\1\d{1,2})?$|^\d{1,2}([./-])\s?\d{1,2}\2\s?\d{4}$|^\d{4}-\d{4}$/

const countDigits = (s: string): number => s.match(/\d/g)?.length ?? 0

export function scrubPII(text: string): string {
  return text
    .replace(EMAIL, '[email address]')
    .replace(PHONE_LIKE, (m) => {
      // Digit-and-space-only runs need 9+ digits so spaced amounts like
      // "1 000 000" survive; real spaced phones (CZ "777 123 456") still hit 9.
      const minDigits = /^[\d\s]+$/.test(m) ? 9 : 7
      return countDigits(m) >= minDigits && !DATE_LIKE.test(m) ? '[phone number]' : m
    })
    .replace(LONG_DIGITS, '[id number]')
}
