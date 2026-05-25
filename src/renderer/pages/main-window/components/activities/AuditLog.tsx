import * as React from 'react'
import { useMemo } from 'react'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import type { ActivityDetail } from '@types'
import type { ActivitiesData } from '@/renderer/hooks/use-activities-data'
import { RecordGroup } from './RecordGroup'
import { formatDayHeading, formatDuration, startOfLocalDay } from './format'

const ROLLUP_GAP_MS = 90 * 1000

interface AuditLogProps {
  activities: ActivitiesData
}

function sameRollupKey(a: ActivityDetail, b: ActivityDetail): boolean {
  return a.appName === b.appName && (a.windowTitle ?? '') === (b.windowTitle ?? '')
}

function matchesQuery(a: ActivityDetail, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return (
    a.appName.toLowerCase().includes(needle) ||
    (a.windowTitle ?? '').toLowerCase().includes(needle) ||
    (a.tld ?? '').toLowerCase().includes(needle) ||
    (a.summary ?? '').toLowerCase().includes(needle)
  )
}

interface DaySummary {
  topApps: string[]
  topTld: string | null
  totalDurationMs: number
  captureCount: number
}

function summarizeDay(runs: ActivityDetail[][]): DaySummary {
  const appCounts = new Map<string, number>()
  const tldCounts = new Map<string, number>()
  let totalDurationMs = 0
  let captureCount = 0
  for (const run of runs) {
    captureCount += run.length
    totalDurationMs += run[run.length - 1].endTimestamp - run[0].startTimestamp
    for (const a of run) {
      appCounts.set(a.appName, (appCounts.get(a.appName) ?? 0) + 1)
      const tld = a.tld?.trim()
      if (tld) tldCounts.set(tld, (tldCounts.get(tld) ?? 0) + 1)
    }
  }
  const topApps = [...appCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([app]) => app)
  const topTldEntry = [...tldCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  const topTld = topTldEntry && topTldEntry[1] / captureCount >= 0.25 ? topTldEntry[0] : null
  return { topApps, topTld, totalDurationMs, captureCount }
}

function groupIntoRunsByDay(
  items: ActivityDetail[],
): { dayStart: number; runs: ActivityDetail[][] }[] {
  // activities arrive newest-first; group into days (keeping newest-first), then
  // within each day group consecutive same-app/same-window into runs.
  const days = new Map<number, ActivityDetail[]>()
  for (const a of items) {
    const day = startOfLocalDay(a.startTimestamp)
    const arr = days.get(day) ?? []
    arr.push(a)
    days.set(day, arr)
  }

  const result: { dayStart: number; runs: ActivityDetail[][] }[] = []
  for (const [dayStart, dayActs] of days) {
    // dayActs is newest-first; sort ascending so roll-up reads chronologically.
    const ascending = [...dayActs].sort((a, b) => a.startTimestamp - b.startTimestamp)
    const runs: ActivityDetail[][] = []
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

export function AuditLog({ activities }: AuditLogProps): React.JSX.Element {
  const {
    items,
    loading,
    loadingMore,
    hasMore,
    query,
    setQuery,
    appFilter,
    setAppFilter,
    tldFilter,
    setTldFilter,
    loadMore,
  } = activities

  const filtered = useMemo(() => {
    let next = items
    if (appFilter) next = next.filter((a) => a.appName === appFilter)
    if (tldFilter) next = next.filter((a) => (a.tld ?? '') === tldFilter)
    if (query) next = next.filter((a) => matchesQuery(a, query))
    return next
  }, [items, query, appFilter, tldFilter])

  const grouped = useMemo(() => groupIntoRunsByDay(filtered), [filtered])

  const anyFilter = Boolean(appFilter || tldFilter || query)

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

      {(appFilter || tldFilter) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-muted-foreground">Filter:</span>
          {appFilter && (
            <FilterChip kind="app" value={appFilter} onClear={() => setAppFilter(null)} />
          )}
          {tldFilter && (
            <FilterChip kind="site" value={tldFilter} onClear={() => setTldFilter(null)} />
          )}
        </div>
      )}

      <div className="text-[11px] text-muted-foreground">
        Showing {filtered.length.toLocaleString()} of {items.length.toLocaleString()} loaded
        captures
        {anyFilter && <> matching current filters</>}. Consecutive captures of the same app and
        window are grouped; click to expand.
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : grouped.length === 0 ? (
        <div className="text-sm text-muted-foreground">No captures match.</div>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ dayStart, runs }) => {
            const summary = summarizeDay(runs)
            const summaryBits: string[] = []
            if (summary.topApps.length > 0) summaryBits.push(summary.topApps.join(' · '))
            if (summary.topTld) summaryBits.push(summary.topTld)
            if (summary.totalDurationMs > 0)
              summaryBits.push(`~${formatDuration(summary.totalDurationMs)}`)
            return (
              <section key={dayStart}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
                    {formatDayHeading(dayStart)}
                  </h3>
                  {summaryBits.length > 0 && (
                    <div className="text-[11px] text-muted-foreground/80 truncate">
                      {summaryBits.join(' · ')}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  {runs.map((run) => (
                    <RecordGroup key={run[0].id} activities={run} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadMore()}
            disabled={loadingMore}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}

function FilterChip({
  kind,
  value,
  onClear,
}: {
  kind: 'app' | 'site'
  value: string
  onClear: () => void
}): React.JSX.Element {
  return (
    <Badge
      variant="secondary"
      render={
        <button type="button" onClick={onClear}>
          <span>
            {kind} · {value}
          </span>
          <span aria-hidden>×</span>
        </button>
      }
    />
  )
}
