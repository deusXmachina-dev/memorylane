/**
 * Deterministic PII/PHI scrub, used as a backstop after the LLM has already been
 * asked to generalize a recipe (see the clustering review prompt). The model
 * handles names (which regex cannot reliably catch); this catches the
 * structured leaks a model sometimes lets through: emails, phone numbers, and
 * long identifier runs. Pure (no deps) so it bundles into both the main and
 * renderer processes.
 *
 * Replacements are typed slot names, not a bare [redacted], so the recipe keeps
 * telling the downstream agent builder what kind of input goes there.
 *
 * Conservative by design: it must never mangle ordinary recipe prose like
 * "4 steps", "top 10", or dates. Bare-digit redaction only fires at 5+ digits;
 * phone redaction needs 7+ digits in a bounded separator run that is not
 * date-shaped. Every quantifier is bounded or sits on a single character
 * class, so matching is linear — no catastrophic backtracking.
 */

// local@label(.label)*.tld — structured as DNS labels (instead of one dot-in-class
// run) so the literal dots are unambiguous and cannot backtrack.
const EMAIL =
  /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,4}\.[A-Za-z]{2,24}\b/g
// A phone-like run: digits with common separators, capped at a realistic phone
// length so one match cannot swallow an arbitrary digit/space stretch. Digit
// count and date shape are re-checked in the replacer.
const PHONE_LIKE = /\+?\d[\d\s().-]{5,22}\d/g
// A bare identifier run (account no., record id, card fragment): 5+ digits.
const LONG_DIGITS = /\b\d{5,}\b/g
// Shapes the phone pass must leave alone: 2026-07-19, 2026/7/9, and year
// ranges like 2024-2025.
const DATE_LIKE = /^\d{4}([-/.])\d{1,2}(?:\1\d{1,2})?$|^\d{4}-\d{4}$/

const countDigits = (s: string): number => s.match(/\d/g)?.length ?? 0

/** Replace emails, phone numbers, and long id/number runs with typed slot
 * names. Leaves ordinary text, dates, and year ranges intact. */
export function scrubPII(text: string): string {
  return text
    .replace(EMAIL, '[email address]')
    .replace(PHONE_LIKE, (m) => (countDigits(m) >= 7 && !DATE_LIKE.test(m) ? '[phone number]' : m))
    .replace(LONG_DIGITS, '[id number]')
}
