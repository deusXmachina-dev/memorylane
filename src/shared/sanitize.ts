/**
 * Deterministic PII/PHI scrub, used as a backstop after the LLM has already been
 * asked to generalize a recipe (see the clustering review prompt). The model
 * handles names (which regex cannot reliably catch); this catches the
 * structured leaks a model sometimes lets through: emails, phone numbers, and
 * long identifier runs. Pure (no deps) so it bundles into both the main and
 * renderer processes.
 *
 * Conservative by design: it must never mangle ordinary recipe prose like
 * "4 steps" or "top 10", so bare-digit redaction only fires at 5+ digits and
 * phone redaction only when a separator-laden run actually holds 7+ digits.
 */

const REDACTED = '[redacted]'

// name@host.tld
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
// A phone-like run: a digit, then 5+ digits/separators, then a digit. The
// separator set excludes letters so it never spans words. Digit count is
// re-checked in the replacer so short separated numbers survive.
const PHONE_LIKE = /\+?\d[\d\s().-]{5,}\d/g
// A bare identifier run (account no., record id, card fragment): 5+ digits.
const LONG_DIGITS = /\b\d{5,}\b/g

/** Redact emails, phone numbers, and long id/number runs. Leaves ordinary text intact. */
export function scrubPII(text: string): string {
  return text
    .replace(EMAIL, REDACTED)
    .replace(PHONE_LIKE, (match) => ((match.match(/\d/g)?.length ?? 0) >= 7 ? REDACTED : match))
    .replace(LONG_DIGITS, REDACTED)
}
