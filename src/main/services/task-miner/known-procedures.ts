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
 * feeding them back would coin assimilation pressure toward noise. `kind` is
 * deliberately NOT filtered: it is advisory display metadata (never a filter),
 * and the worst-drifting recurrers are monitoring/judgment clusters that a
 * procedure-only gate would exclude.
 */
export function getKnownProcedureTitles(storage: StorageService, cap = 40): string[] {
  const clusters = storage.clusters
    .getAllWithStats()
    .filter((c) => c.timesSeen >= 2 && c.label.trim() !== '')

  // getAllWithStats orders by times_seen DESC then created_at ASC, but
  // created_at is non-unique (a full rebuild stamps every cluster with one
  // value), so re-sort with a stable label tie-break for deterministic output.
  clusters.sort((a, b) => b.timesSeen - a.timesSeen || a.label.localeCompare(b.label))

  const seen = new Set<string>()
  const titles: string[] = []
  for (const c of clusters) {
    const label = c.label.trim()
    const key = label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    titles.push(label)
    if (titles.length >= cap) break
  }
  return titles
}
