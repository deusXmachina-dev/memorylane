import type { StorageService } from '../../storage'

/**
 * Canonical titles of established recurring procedures, fed back into the scan
 * as vocabulary so a procedure gets the same title on every day it recurs.
 * Vocabulary-only: it reuses the title *string*, never a cluster id or a
 * "prefer matching" instruction — identity stays with the deterministic
 * clustering + LLM review.
 *
 * A title qualifies only when its cluster has actually recurred
 * (`timesSeen >= 2`) and carries a review label. Single-sighting labels are
 * skipped — most are merge ride-along labels below the UI noise floor, so
 * feeding them back would coin assimilation pressure toward noise. Whether the
 * cluster was judged automatable is deliberately NOT filtered on: the
 * worst-drifting recurrers are monitoring/judgment clusters that a
 * procedure-only gate would exclude.
 */
export function getKnownProcedureTitles(storage: StorageService, cap = 40): string[] {
  const labels = storage.clusters
    .getRecurringLabels()
    .filter((r) => r.label.trim() !== '')
    .sort((a, b) => b.timesSeen - a.timesSeen || a.label.localeCompare(b.label))

  const seen = new Set<string>()
  const titles: string[] = []
  for (const r of labels) {
    const label = r.label.trim()
    const key = label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    titles.push(label)
    if (titles.length >= cap) break
  }
  return titles
}
