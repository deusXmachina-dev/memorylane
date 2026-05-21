import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import type { MainWindowAPI, RecentActivity } from '@types'
import { RecordGroup } from './RecordGroup'
import { formatDayHeading, startOfLocalDay } from './format'

const PAGE_SIZE = 200
const ROLLUP_GAP_MS = 90 * 1000

interface AuditLogProps {
  api: MainWindowAPI
}

function sameRollupKey(a: RecentActivity, b: RecentActivity): boolean {
  return a.appName === b.appName && (a.windowTitle ?? '') === (b.windowTitle ?? '')
}

function matchesQuery(a: RecentActivity, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return (
    a.appName.toLowerCase().includes(needle) ||
    (a.windowTitle ?? '').toLowerCase().includes(needle) ||
    (a.tld ?? '').toLowerCase().includes(needle) ||
    (a.summary ?? '').toLowerCase().includes(needle)
  )
}

function groupIntoRunsByDay(
  activities: RecentActivity[],
): { dayStart: number; runs: RecentActivity[][] }[] {
  // activities arrive newest-first; group into days (keeping newest-first), then
  // within each day group consecutive same-app/same-window into runs.
  const days = new Map<number, RecentActivity[]>()
  for (const a of activities) {
    const day = startOfLocalDay(a.startTimestamp)
    const arr = days.get(day) ?? []
    arr.push(a)
    days.set(day, arr)
  }

  const result: { dayStart: number; runs: RecentActivity[][] }[] = []
  for (const [dayStart, dayActs] of days) {
    // dayActs is newest-first; sort ascending so roll-up reads chronologically.
    const ascending = [...dayActs].sort((a, b) => a.startTimestamp - b.startTimestamp)
    const runs: RecentActivity[][] = []
    for (const a of ascending) {
      const last = runs[runs.length - 1]
      const prev = last?.[last.length - 1]
      if (
        last &&
        prev &&
        sameRollupKey(prev, a) &&
        a.startTimestamp - prev.endTimestamp <= ROLLUP_GAP_MS
      ) {
        last.push(a)
      } else {
        runs.push([a])
      }
    }
    // Show newest run first within the day.
    runs.reverse()
    result.push({ dayStart, runs })
  }
  // Days newest first.
  result.sort((a, b) => b.dayStart - a.dayStart)
  return result
}

export function AuditLog({ api }: AuditLogProps): React.JSX.Element {
  const [items, setItems] = useState<RecentActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [query, setQuery] = useState('')

  const loadPage = useCallback(
    async (offset: number): Promise<RecentActivity[]> => {
      try {
        return await api.listRecentActivities(PAGE_SIZE, offset)
      } catch {
        return []
      }
    },
    [api],
  )

  useEffect(() => {
    let cancelled = false
    void loadPage(0).then((rows) => {
      if (cancelled) return
      setItems(rows)
      setHasMore(rows.length === PAGE_SIZE)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [loadPage])

  const handleLoadMore = useCallback(async () => {
    setLoadingMore(true)
    const next = await loadPage(items.length)
    setItems((prev) => [...prev, ...next])
    setHasMore(next.length === PAGE_SIZE)
    setLoadingMore(false)
  }, [items.length, loadPage])

  const filtered = useMemo(
    () => (query ? items.filter((a) => matchesQuery(a, query)) : items),
    [items, query],
  )

  const grouped = useMemo(() => groupIntoRunsByDay(filtered), [filtered])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search captures (app, title, summary, site)"
          className="h-8 text-sm"
        />
        {query && (
          <Button variant="ghost" size="sm" onClick={() => setQuery('')}>
            Clear
          </Button>
        )}
      </div>

      <div className="text-[11px] text-muted-foreground">
        Showing {filtered.length.toLocaleString()} of {items.length.toLocaleString()} loaded
        captures
        {query && <> matching “{query}”</>}. Consecutive captures of the same app and window are
        grouped; click to expand.
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : grouped.length === 0 ? (
        <div className="text-sm text-muted-foreground">No captures match.</div>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ dayStart, runs }) => (
            <section key={dayStart}>
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
                {formatDayHeading(dayStart)}
              </h3>
              <div className="flex flex-col gap-1.5">
                {runs.map((run) => (
                  <RecordGroup key={run[0].id} activities={run} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleLoadMore()}
            disabled={loadingMore}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}
