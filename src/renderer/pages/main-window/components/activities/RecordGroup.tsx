import * as React from 'react'
import { useState } from 'react'
import type { ActivityDetail } from '@types'
import { formatClock, formatDuration } from './format'

interface RecordGroupProps {
  activities: ActivityDetail[]
}

function groupLabel(first: ActivityDetail): string {
  const main = first.windowTitle?.trim() || first.summary?.trim() || first.appName
  return main
}

function groupSubtitle(first: ActivityDetail): string {
  return first.tld ? `${first.appName} · ${first.tld}` : first.appName
}

export function RecordGroup({ activities }: RecordGroupProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const first = activities[0]
  const last = activities[activities.length - 1]
  const rangeLabel =
    activities.length === 1
      ? formatClock(first.startTimestamp)
      : `${formatClock(first.startTimestamp)}–${formatClock(last.endTimestamp)}`
  const durationMs = last.endTimestamp - first.startTimestamp

  // De-duplicate consecutive identical summaries when expanded — within a roll-up
  // the same summary often repeats verbatim across captures.
  const dedupedSummaries: { activity: ActivityDetail; summary: string }[] = []
  for (const a of activities) {
    const s = a.summary?.trim()
    if (!s) continue
    const prev = dedupedSummaries[dedupedSummaries.length - 1]
    if (prev?.summary === s) continue
    dedupedSummaries.push({ activity: a, summary: s })
  }

  const headlineSummary = first.summary?.trim()

  return (
    <div className="rounded-md ring-1 ring-foreground/10 bg-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-3 py-2 hover:bg-muted/40 rounded-md"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-sm font-medium truncate">{groupLabel(first)}</div>
          <div className="text-xs text-muted-foreground shrink-0 font-mono tabular-nums">
            {rangeLabel}
          </div>
        </div>
        <div className="flex items-baseline justify-between gap-3 mt-0.5">
          <div className="text-xs text-muted-foreground truncate">{groupSubtitle(first)}</div>
          <div className="text-[11px] text-muted-foreground shrink-0">
            {activities.length === 1
              ? '1 capture'
              : `${activities.length} captures · ${formatDuration(durationMs)}`}
            <span className="ml-2 inline-block w-3 text-center">{expanded ? '▾' : '▸'}</span>
          </div>
        </div>
        {!expanded && headlineSummary && (
          <div className="text-xs text-muted-foreground/90 mt-1 line-clamp-2">
            {headlineSummary}
          </div>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-foreground/5">
          {dedupedSummaries.length === 0 ? (
            <div className="text-xs text-muted-foreground/80">
              No AI summary recorded for these captures.
            </div>
          ) : (
            <ul className="space-y-1.5 mt-1.5">
              {dedupedSummaries.map(({ activity, summary }, i) => (
                <li key={`${activity.id}-${i}`} className="text-xs leading-snug">
                  <div className="text-muted-foreground font-mono tabular-nums">
                    {formatClock(activity.startTimestamp)}
                  </div>
                  <div className="text-muted-foreground/90">{summary}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
