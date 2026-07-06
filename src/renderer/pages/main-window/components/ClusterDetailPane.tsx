import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { ScrollArea } from '@components/ui/scroll-area'
import { ChevronDown, ChevronUp, Copy } from 'lucide-react'
import type { ClusterDetailInfo, ClusterInfo, ClusterSightingInfo, MainWindowAPI } from '@types'
import { formatFrequency } from './ClusterListItem'
import { RecurrenceBars } from './RecurrenceBars'

interface ClusterDetailPaneProps {
  api: MainWindowAPI
  cluster: ClusterInfo
}

// Delay showing "Loading…" so fast list-nav between clusters doesn't flash.
const LOADING_DELAY_MS = 150
const INITIAL_SIGHTINGS = 3

function formatMonthDay(timestamp: number | null): string {
  if (timestamp === null) return '—'
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatSightingTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatInteraction(min: number): string {
  if (min >= 60) return `${(min / 60).toFixed(1)}h`
  return `${Math.max(1, Math.round(min))}m`
}

function buildCopyPrompt(cluster: ClusterInfo, sightings: ClusterSightingInfo[]): string {
  const recent = sightings.slice(0, 5)
  const sampleActivityIds = recent.flatMap((s) => s.activityIds).slice(0, 20)
  const lines = [
    `I want to automate this recurring task: "${cluster.title}".`,
    ``,
    cluster.description ? `Context: ${cluster.description}` : null,
    `Apps involved: ${cluster.apps.join(', ') || 'unknown'}.`,
    cluster.timesPerWeek > 0
      ? `I do this about ${formatFrequency(cluster.timesPerWeek)} (${cluster.timesSeen} runs over ${cluster.observedDays} active days); a run takes ~${Math.round(cluster.avgSpanMin)} min start-to-end (~${Math.round(cluster.avgActiveMin)} min hands-on).`
      : `I've done this ${cluster.timesSeen} time${cluster.timesSeen === 1 ? '' : 's'}; a run takes ~${Math.round(cluster.avgSpanMin)} min start-to-end (~${Math.round(cluster.avgActiveMin)} min hands-on).`,
    ``,
    `## Step 1 — Research`,
    ``,
    `Use the MemoryLane MCP tools to understand what this task really involves:`,
    ``,
    sampleActivityIds.length > 0
      ? `1. Call get_activity_details on these activity IDs to read the OCR evidence of what I actually did: ${sampleActivityIds.join(', ')}.`
      : `1. Call browse_timeline around the occurrences below to see what I was doing.`,
    `2. Call browse_timeline around those timestamps (±15 minutes) to see the full workflow — what triggers this task and what follows.`,
    ``,
    `Recent occurrences:`,
    ...recent.map((s) => `- ${formatSightingTime(s.startedAt)} — ${s.title}`),
    ``,
    `## Step 2 — Ask me questions`,
    ``,
    `Before building anything, ask me clarifying questions:`,
    `- Which steps vary between occurrences?`,
    `- What inputs or variables are needed?`,
    `- What tools, APIs, or services do I have available?`,
    ``,
    `Wait for my answers before proceeding.`,
    ``,
    `## Step 3 — Create a Claude Code skill`,
    ``,
    `Based on your research and my answers, use /skill-creator to create a skill that automates this task.`,
  ]
  return lines.filter((l) => l !== null).join('\n')
}

function Stat({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-2xl font-semibold tabular-nums leading-none truncate">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  )
}

export function ClusterDetailPane({ api, cluster }: ClusterDetailPaneProps): React.JSX.Element {
  const [detail, setDetail] = useState<ClusterDetailInfo | null>(null)
  const [showLoading, setShowLoading] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setShowLoading(false)
    setShowAll(false)
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
      .getClusterDetail(cluster.id)
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
  }, [api, cluster.id])

  const sightings = detail?.sightings ?? []
  const visibleSightings = showAll ? sightings : sightings.slice(0, INITIAL_SIGHTINGS)

  const handleCopyPrompt = (): void => {
    navigator.clipboard
      .writeText(buildCopyPrompt(cluster, sightings))
      .then(() => toast.success('Copied! Paste it into Claude Cowork'))
      .catch((err) => {
        console.warn('[clusters] clipboard.writeText failed', err)
        toast.error('Could not copy prompt to clipboard')
      })
  }

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-6 py-5 space-y-5">
          {/* Header */}
          <div>
            <div
              className="text-[11px] uppercase tracking-wide text-muted-foreground"
              title={`${cluster.timesSeen} runs across ${cluster.observedDays} active days`}
            >
              Cluster ·{' '}
              {formatFrequency(cluster.timesPerWeek) &&
                `${formatFrequency(cluster.timesPerWeek)} · `}
              Seen {cluster.timesSeen}× since {formatMonthDay(cluster.firstSeenAt)}
            </div>
            <h2 className="mt-1 text-xl font-semibold leading-tight">{cluster.title}</h2>
            {cluster.description && (
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                {cluster.description}
              </p>
            )}
            {cluster.kind === 'procedure' && cluster.mechanism && (
              <p className="mt-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm leading-relaxed">
                <span className="font-medium">Replace with:</span> {cluster.mechanism}
              </p>
            )}
            {cluster.apps.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {cluster.apps.map((app) => (
                  <Badge key={app} variant="secondary" className="text-[10px]">
                    {app}
                  </Badge>
                ))}
              </div>
            )}
            <Button size="sm" onClick={handleCopyPrompt} className="mt-4">
              <Copy className="w-3.5 h-3.5 mr-1.5" />
              Copy prompt for Claude
            </Button>
          </div>

          {/* Stats */}
          <div className="border-y py-4">
            <div className="grid grid-cols-4 gap-3">
              <Stat value={String(cluster.timesSeen)} label="Times seen" />
              <Stat value={formatInteraction(cluster.avgSpanMin)} label="Span / run" />
              <Stat value={formatInteraction(cluster.avgActiveMin)} label="Active / run" />
              <Stat value={formatInteraction(cluster.totalActiveMin)} label="Total active (90d)" />
            </div>
            {cluster.avgIdleMin >= 2 && (
              <p className="mt-3 text-[11px] text-muted-foreground">
                ~{Math.round(cluster.avgIdleMin)}m inactive per run — the span includes breaks and
                interruptions.
              </p>
            )}
          </div>

          {/* Recurrence */}
          <div>
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-semibold">Recurrence</h3>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Sightings / {cluster.recurrenceUnit === 'week' ? 'week' : 'day'}
              </span>
            </div>
            <RecurrenceBars
              className="mt-3"
              buckets={cluster.recurrence}
              unit={cluster.recurrenceUnit}
            />
          </div>

          {/* Sightings */}
          <div>
            <div className="flex items-baseline gap-2">
              <h3 className="text-sm font-semibold">Sightings</h3>
              <span className="text-[11px] text-muted-foreground uppercase tracking-wide">
                {cluster.timesSeen} instance{cluster.timesSeen === 1 ? '' : 's'}
              </span>
            </div>

            {showLoading && !detail && (
              <div className="mt-3 text-xs text-muted-foreground">Loading sightings…</div>
            )}

            {detail && sightings.length === 0 && (
              <div className="mt-3 text-xs text-muted-foreground">No sightings recorded.</div>
            )}

            {visibleSightings.length > 0 && (
              <ol className="mt-3 space-y-3">
                {visibleSightings.map((s, i) => (
                  <li key={s.id} className="flex gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium leading-snug">{s.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                        {s.apps.map((app) => (
                          <Badge key={app} variant="outline" className="text-[10px] font-normal">
                            {app}
                          </Badge>
                        ))}
                        <span className="tabular-nums">
                          {formatInteraction(s.activeMin)} active
                        </span>
                        <span aria-hidden>·</span>
                        <span className="tabular-nums">{formatSightingTime(s.startedAt)}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {sightings.length > INITIAL_SIGHTINGS && (
              <button
                type="button"
                onClick={() => setShowAll((p) => !p)}
                className="mt-3 flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
              >
                {showAll ? (
                  <>
                    <ChevronUp className="w-3.5 h-3.5" />
                    Show fewer
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3.5 h-3.5" />
                    Show all {sightings.length} sightings
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
