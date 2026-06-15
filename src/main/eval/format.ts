/** Shared Markdown-scorecard formatting helpers for the eval reports. */

/** Fixed-decimal number, or `—` for null/NaN. */
export function num(n: number | null, digits = 2): string {
  return n === null || Number.isNaN(n) ? '—' : n.toFixed(digits)
}

/** A 0..1 ratio as a percentage, or `—` for null/NaN. */
export function pct(x: number | null, digits = 0): string {
  return x === null || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(digits)}%`
}

/** A USD amount as `$0.0000`, or `—` for null. */
export function usd(x: number | null): string {
  return x === null ? '—' : `$${x.toFixed(4)}`
}

/** Escapes free text for a Markdown table cell (pipes, newlines → <br>). */
export function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim()
}
