import { useEffect, useRef, useState } from 'react'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { ScrollArea } from '@components/ui/scroll-area'
import { Check, Copy, ThumbsDown, ThumbsUp, Undo2 } from 'lucide-react'
import type { MainWindowAPI, PatternDetailInfo, PatternInfo } from '@types'

interface PatternDetailPaneProps {
  api: MainWindowAPI
  pattern: PatternInfo
  onApprove: (id: string) => void
  onDismiss: (id: string, name: string) => void
  onComplete: (id: string) => void
  onUncomplete: (id: string) => void
  onCopyPrompt: (pattern: PatternInfo) => void
}

// Delay showing "Loading evidence…" so fast list-nav between patterns doesn't
// flash the message between every selection.
const LOADING_DELAY_MS = 150

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDay(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatRecurrence(pattern: PatternInfo): string | null {
  if (pattern.sightingCount === 0) return null
  if (pattern.estimatedHoursPerWeek === null || pattern.lastSeenAt === null) {
    return `Seen ${pattern.sightingCount} time${pattern.sightingCount === 1 ? '' : 's'}.`
  }
  const hrs = pattern.estimatedHoursPerWeek
  const hoursText = hrs >= 1 ? `~${hrs.toFixed(1)} hours` : `~${Math.round(hrs * 60)} minutes`
  return `Seen ${pattern.sightingCount} times. Estimated ${hoursText}/week spent on this.`
}

function formatSightingDuration(min: number | null): string | null {
  if (min === null) return null
  if (min >= 60) return `~${(min / 60).toFixed(1)}h`
  return `~${Math.round(min)}m`
}

export function PatternDetailPane({
  api,
  pattern,
  onApprove,
  onDismiss,
  onComplete,
  onUncomplete,
  onCopyPrompt,
}: PatternDetailPaneProps): React.JSX.Element {
  const [detail, setDetail] = useState<PatternDetailInfo | null>(null)
  const [showLoading, setShowLoading] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setShowLoading(false)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      if (!cancelled) setShowLoading(true)
    }, LOADING_DELAY_MS)
    const clearTimer = (): void => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
    api
      .getPatternDetail(pattern.id)
      .then((d) => {
        if (cancelled) return
        clearTimer()
        setDetail(d)
        setShowLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        clearTimer()
        setShowLoading(false)
      })
    return () => {
      cancelled = true
      clearTimer()
    }
  }, [api, pattern.id])

  const recurrence = formatRecurrence(pattern)

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-5 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold truncate">{pattern.name}</h2>
          {recurrence && <p className="text-xs text-muted-foreground mt-0.5">{recurrence}</p>}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {pattern.completedAt === null ? (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onComplete(pattern.id)}
              title="Mark as done"
              aria-label="Mark as done"
            >
              <Check className="w-3.5 h-3.5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onUncomplete(pattern.id)}
              title="Mark as not done"
              aria-label="Mark as not done"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onApprove(pattern.id)}
            className={pattern.approvedAt ? 'text-green-500' : ''}
            title="Useful"
            aria-label="Mark pattern as useful"
            aria-pressed={pattern.approvedAt !== null}
          >
            <ThumbsUp className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onDismiss(pattern.id, pattern.name)}
            title="Not useful"
            aria-label="Dismiss pattern as not useful"
          >
            <ThumbsDown className="w-3.5 h-3.5 scale-x-[-1]" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-5 py-4 space-y-4">
          {(pattern.description || pattern.automationIdea) && (
            <p className="text-sm text-muted-foreground">
              {pattern.description || pattern.automationIdea}
            </p>
          )}

          {pattern.apps.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {pattern.apps.map((app) => (
                <Badge key={app} variant="secondary" className="text-[10px]">
                  {app}
                </Badge>
              ))}
            </div>
          )}

          <Button size="sm" onClick={() => onCopyPrompt(pattern)} className="w-full">
            <Copy className="w-3.5 h-3.5 mr-1.5" />
            Copy prompt for Claude
          </Button>

          <div className="pt-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              Evidence
            </h3>

            {showLoading && !detail && (
              <div className="text-xs text-muted-foreground">Loading evidence…</div>
            )}

            {detail && detail.sightings.length === 0 && (
              <div className="text-xs text-muted-foreground">No sightings recorded.</div>
            )}

            {detail && detail.sightings.length > 0 && (
              <ol className="space-y-3 relative">
                {detail.sightings.map((sighting) => {
                  const confPct = Math.round(sighting.confidence * 100)
                  const durationText = formatSightingDuration(sighting.durationEstimateMin)

                  return (
                    <li key={sighting.id} className="rounded-md border bg-card/50 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium">{formatDay(sighting.detectedAt)}</span>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          {durationText && <span>{durationText}</span>}
                          <span>~{confPct}% confidence</span>
                        </div>
                      </div>
                      {sighting.evidence && (
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {sighting.evidence}
                        </p>
                      )}
                      {sighting.activities.length > 0 && (
                        <ul className="space-y-1 pt-1">
                          {sighting.activities.map((a) => (
                            <li key={a.id} className="text-[11px] flex items-baseline gap-2">
                              <span className="text-muted-foreground tabular-nums shrink-0">
                                {formatTime(a.startTimestamp)}
                              </span>
                              <span className="text-muted-foreground shrink-0">·</span>
                              <span className="text-foreground/80 shrink-0">{a.appName}</span>
                              {(a.windowTitle || a.summary) && (
                                <>
                                  <span className="text-muted-foreground shrink-0">·</span>
                                  <span className="truncate text-muted-foreground">
                                    {a.windowTitle || a.summary}
                                  </span>
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
