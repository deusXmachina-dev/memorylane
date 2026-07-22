import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { ScrollArea } from '@components/ui/scroll-area'
import { ChevronDown, ChevronUp, Copy } from 'lucide-react'
import type { ClusterDetailInfo, ClusterInfo, ClusterSightingInfo, MainWindowAPI } from '@types'
import { formatFrequency, formatMinutes, formatMonthlyHours } from './activities/format'
import { WeeklyTrend } from './WeeklyTrend'
import { ClaudeWordmark } from './ClaudeWordmark'
import { scrubPII } from '@/shared/sanitize'

interface ClusterDetailPaneProps {
  api: MainWindowAPI
  cluster: ClusterInfo
}

// Delay showing "Loading…" so fast list-nav between clusters doesn't flash.
const LOADING_DELAY_MS = 150
const INITIAL_SIGHTINGS = 3

function formatSightingTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function buildCopyPrompt(cluster: ClusterInfo, sightings: ClusterSightingInfo[]): string {
  const recent = sightings.slice(0, 5)
  const sampleActivityIds = recent.flatMap((s) => s.activityIds).slice(0, 20)
  const lines = [
    `Here's a recurring task I'd like to explore: "${cluster.title}".`,
    ``,
    cluster.description ? `Context: ${cluster.description}` : null,
    `Apps involved: ${cluster.apps.join(', ') || 'unknown'}.`,
    cluster.timesPerWeek > 0
      ? `I do this about ${formatFrequency(cluster.timesPerWeek)} (${cluster.timesSeen} runs over ${cluster.observedDays} active days); a run takes ~${Math.round(cluster.avgActiveMin)} min of hands-on work.`
      : `I've done this ${cluster.timesSeen} time${cluster.timesSeen === 1 ? '' : 's'}; a run takes ~${Math.round(cluster.avgActiveMin)} min of hands-on work.`,
    ``,
    sampleActivityIds.length > 0
      ? `Activity IDs for research: ${sampleActivityIds.join(', ')}.`
      : null,
    ``,
    `Recent occurrences:`,
    ...recent.map(
      (s) => `- ${formatSightingTime(s.startedAt)}: ${s.title}${s.subject ? `, ${s.subject}` : ''}`,
    ),
    ``,
    `## Step 1: What would you like to do?`,
    ``,
    `Use AskUserQuestion to ask me:`,
    `1. **Build a Claude Skill** to automate this task`,
    `2. **Analyze this pattern** to understand the workflow in detail`,
    ``,
    `---`,
    ``,
    `## Path 1: Build a Claude Skill`,
    ``,
    `### Research`,
    `Use the MemoryLane MCP tools to understand what this task really involves:`,
    sampleActivityIds.length > 0
      ? `1. Call get_activity_details on the activity IDs above to read the OCR evidence of what I actually did.`
      : `1. Call browse_timeline around the occurrences above to see what I was doing.`,
    `2. Call browse_timeline around those timestamps (±15 minutes) to see the full workflow.`,
    ``,
    `### Ask me questions`,
    `Before building, ask me:`,
    `- Which steps vary between occurrences?`,
    `- What inputs or variables are needed?`,
    `- What tools, APIs, or services do I have available?`,
    ``,
    `Wait for my answers, then use /skill-creator to create a skill that automates this task.`,
    ``,
    `---`,
    ``,
    `## Path 2: Analyze this pattern`,
    ``,
    `### Quick analysis`,
    `Use the MemoryLane MCP tools:`,
    sampleActivityIds.length > 0
      ? `1. Call get_activity_details on the activity IDs above.`
      : `1. Call browse_timeline around the occurrences above.`,
    `2. Call browse_timeline around those timestamps (±15 minutes).`,
    ``,
    `Then summarize:`,
    `- Step-by-step workflow (activity level, not click level)`,
    `- Time per app per run`,
    `- What varies vs what stays constant across runs`,
    `- Rough automatable rating: low / medium / high`,
    ``,
    `### What next?`,
    `After the summary, use AskUserQuestion:`,
    `1. **Build a Claude Skill** (skip research since you already did it, go straight to asking me questions from Path 1, then use /skill-creator)`,
    `2. **Run deep ROI analysis** (deep dive with time/cost quantification and automation recommendations)`,
    `3. **I'm done, thanks**`,
    ``,
    `If "Run deep ROI analysis": invoke /process-analyst-new focused on this pattern.`,
    `If /process-analyst-new is not available, suggest I install the MemoryLane plugin for Claude Code (it includes the process analyst skill for deep workflow analysis and a reporting skill to generate shareable reports). Then offer to run a lighter analysis inline using the MCP tools instead (decompose steps, estimate time per step, flag what looks automatable).`,
  ]
  return lines.filter((l) => l !== null).join('\n')
}

/** Tool-agnostic prompt built from the stored, de-identified recipe;
 * scrubPII runs over the final string as a last-mile net. */
function buildAgentPrompt(cluster: ClusterInfo): string {
  const lines: string[] = [
    `Build an AI agent that automates this task.`,
    ``,
    `Goal: ${cluster.description || cluster.title}`,
    ``,
  ]
  if (cluster.steps.length > 0) {
    lines.push(`Step-by-step:`)
    cluster.steps.forEach((step, i) => lines.push(`${i + 1}. ${step}`))
  } else {
    lines.push(
      `Apps: ${cluster.apps.join(', ') || 'unknown'}. Work out the steps, then confirm with me.`,
    )
  }
  if (cluster.variables.length > 0) {
    lines.push(``, `Changes each run: ${cluster.variables.join(', ')}.`)
  }
  lines.push(``, `Before building, ask me:`)
  if (cluster.variables.length === 0) {
    lines.push(`- Which steps or inputs change each run?`)
  }
  lines.push(
    `- What tools and API access are available?`,
    `- What should happen when a step fails?`,
    ``,
    `Then build it and tell me how to run it.`,
  )
  return scrubPII(lines.join('\n'))
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
  const [loadFailed, setLoadFailed] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setShowLoading(false)
    setLoadFailed(false)
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
        setLoadFailed(true)
      })
    return () => {
      cancelled = true
      clearTimer()
    }
  }, [api, cluster.id])

  const sightings = detail?.sightings ?? []
  const visibleSightings = showAll ? sightings : sightings.slice(0, INITIAL_SIGHTINGS)
  const trendTimestamps = useMemo(() => (detail?.sightings ?? []).map((s) => s.startedAt), [detail])

  const handleCopyPrompt = (): void => {
    navigator.clipboard
      .writeText(buildCopyPrompt(cluster, sightings))
      .then(() => toast.success('Copied! Paste it into Claude Cowork'))
      .catch((err) => {
        console.warn('[clusters] clipboard.writeText failed', err)
        toast.error('Could not copy prompt to clipboard')
      })
  }

  const handleCopyAgentPrompt = (): void => {
    navigator.clipboard
      .writeText(buildAgentPrompt(cluster))
      .then(() => toast.success('Agent prompt copied to clipboard'))
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
            <h2 className="text-xl font-semibold leading-tight">{cluster.title}</h2>
            {cluster.steps.length > 0 ? (
              <div className="mt-2">
                <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed marker:text-muted-foreground">
                  {cluster.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
                {cluster.variables.length > 0 && (
                  <p className="mt-2 text-[11px] text-muted-foreground/70">
                    Changes each run: {cluster.variables.join(', ')}
                  </p>
                )}
              </div>
            ) : (
              cluster.description && (
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {cluster.description}
                </p>
              )
            )}
            {cluster.kind === 'procedure' && cluster.mechanism && (
              <p className="mt-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm leading-relaxed">
                <span className="font-medium">Replace with:</span> {cluster.mechanism}
              </p>
            )}
            {/* Build AI agent uses the stored recipe; Analyze needs sightings loaded (activity ids). */}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={handleCopyAgentPrompt}>
                <Copy className="w-3.5 h-3.5 mr-1.5" />
                Build AI agent
              </Button>
              <Button size="sm" variant="secondary" onClick={handleCopyPrompt} disabled={!detail}>
                <Copy className="w-3.5 h-3.5 mr-1.5" />
                Open in
                <ClaudeWordmark />
              </Button>
            </div>
          </div>

          {/* Stats */}
          <div className="border-y py-4">
            <div className="grid grid-cols-3 gap-3">
              <Stat value={`${cluster.timesSeen}×`} label="Times done" />
              <Stat value={formatMinutes(cluster.avgActiveMin)} label="Avg. net time" />
              <Stat
                value={formatMonthlyHours(cluster.avgActiveMin, cluster.timesPerWeek) || '—'}
                label="Est. per month"
              />
            </div>
          </div>

          {/* Last 4 weeks — only once sightings are in, so the chart never shows
              a false flat-zero while loading (or after a failed load). */}
          {detail && (
            <div>
              <h3 className="text-sm font-semibold">Last 4 weeks</h3>
              <WeeklyTrend className="mt-2" timestamps={trendTimestamps} />
            </div>
          )}

          {/* Sightings */}
          <div>
            <h3 className="text-sm font-semibold">History</h3>

            {showLoading && !detail && (
              <div className="mt-3 text-xs text-muted-foreground">Loading sightings…</div>
            )}

            {loadFailed && (
              <div className="mt-3 text-xs text-destructive">Couldn't load sightings.</div>
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
                      <div className="text-sm font-medium leading-snug">
                        {s.title}
                        {s.subject && (
                          <span className="font-normal text-muted-foreground"> — {s.subject}</span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground/50">
                        <span>
                          {s.apps.length} app{s.apps.length === 1 ? '' : 's'}
                        </span>
                        <span aria-hidden>·</span>
                        <span className="tabular-nums">{formatMinutes(s.activeMin)}</span>
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
