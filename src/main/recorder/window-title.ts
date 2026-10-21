export function normalizeTitle(title: string): string {
  return title
    .replace(/[\p{So}\p{Sk}️‍]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * True when `next` is `prev` with text inserted or deleted at one spot, the way
 * typing changes a title that mirrors document text (Windows 11 Notepad shows an
 * unsaved tab's first line). Replacements like `a.ts` -> `b.ts` or `(3)` -> `(4)`
 * are real changes.
 */
export function isIncrementalTitleEdit(prev: string, next: string): boolean {
  if (!prev || !next || prev === next) return false
  const shorter = Math.min(prev.length, next.length)
  let prefix = 0
  while (prefix < shorter && prev[prefix] === next[prefix]) prefix++
  let suffix = 0
  while (
    suffix < shorter - prefix &&
    prev[prev.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++
  }
  return prev.length === prefix + suffix || next.length === prefix + suffix
}
