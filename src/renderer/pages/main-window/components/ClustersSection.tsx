import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { PingDot } from '@components/ui/ping-dot'
import { ScrollArea } from '@components/ui/scroll-area'
import type { ClusterInfo, MainWindowAPI, MiningStatus } from '@types'
import { ClusterListItem } from './ClusterListItem'
import { ClusterDetailPane } from './ClusterDetailPane'

function MiningProgressBanner({ status }: { status: MiningStatus }): React.JSX.Element {
  const done = status.completedDays + status.failedDays
  const mining = status.state === 'mining'
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="flex min-w-0 items-center gap-2 font-medium text-foreground/85">
        <PingDot active={mining} />
        <span className="truncate">{mining ? 'Analyzing your history' : 'Analysis paused'}</span>
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {done} of {status.totalDays} days
      </span>
    </div>
  )
}

const SORTS = [
  { id: 'seen', label: 'Most often' },
  { id: 'recent', label: 'Recent' },
  { id: 'longest', label: 'Longest' },
] as const
type SortId = (typeof SORTS)[number]['id']

const INITIAL_VISIBLE = 5

interface ClustersSectionProps {
  api: MainWindowAPI
  clusters: ClusterInfo[]
  /** Clusters hidden by the noise floor (seen once, little total time). */
  hiddenCount: number
  miningStatus: MiningStatus | null
}

export function ClustersSection({
  api,
  clusters,
  hiddenCount,
  miningStatus,
}: ClustersSectionProps): React.JSX.Element {
  const [sort, setSort] = useState<SortId>('seen')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [detectionEnabled, setDetectionEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    api
      .getCaptureSettings()
      .then((s) => setDetectionEnabled(s.patternDetectionEnabled))
      .catch(() => setDetectionEnabled(true))
  }, [api])

  const sorted = useMemo(() => {
    const copy = [...clusters]
    switch (sort) {
      case 'recent':
        copy.sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))
        break
      case 'longest':
        copy.sort((a, b) => b.avgActiveMin - a.avgActiveMin)
        break
      case 'seen':
      default:
        copy.sort((a, b) => b.timesSeen - a.timesSeen)
        break
    }
    return copy
  }, [clusters, sort])

  // Keep the user's pick if it's still around, else fall back to the top item.
  const effectiveSelectedId =
    (selectedId && clusters.some((c) => c.id === selectedId) && selectedId) || sorted[0]?.id || null
  const selected = useMemo(
    () => clusters.find((c) => c.id === effectiveSelectedId) ?? null,
    [clusters, effectiveSelectedId],
  )

  const visible = expanded ? sorted : sorted.slice(0, INITIAL_VISIBLE)
  const collapsedCount = sorted.length - visible.length

  if (detectionEnabled === false) {
    return (
      <div className="space-y-3 max-w-xl">
        <p className="text-sm text-muted-foreground">
          MemoryLane can analyze your daily activity to find recurring tasks you could automate.
        </p>
        <Button
          size="sm"
          onClick={() => {
            setDetectionEnabled(true)
            api.saveCaptureSettings({ patternDetectionEnabled: true }).then((result) => {
              if (result.success) toast.success('Task discovery enabled')
            })
          }}
        >
          Start discovering
        </Button>
      </div>
    )
  }

  const miningActive =
    miningStatus !== null &&
    miningStatus.totalDays > 0 &&
    (miningStatus.state === 'mining' || miningStatus.pendingDays > 0)

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      {miningActive && <MiningProgressBanner status={miningStatus} />}
      {clusters.length > 0 && (
        <div className="flex items-center gap-1">
          {SORTS.map((s) => (
            <Button
              key={s.id}
              size="sm"
              variant={sort === s.id ? 'default' : 'secondary'}
              className="rounded-full h-7 px-3 text-xs"
              onClick={() => setSort(s.id)}
            >
              {s.label}
            </Button>
          ))}
        </div>
      )}

      {clusters.length === 0 ? (
        <div className="text-sm text-muted-foreground py-12 text-center">
          {hiddenCount > 0
            ? `No recurring patterns yet. ${hiddenCount} one-off group${hiddenCount === 1 ? '' : 's'} will appear here if seen again.`
            : 'No patterns yet. Keep using your computer — MemoryLane surfaces recurring tasks once it has enough history.'}
        </div>
      ) : (
        <div className="grid grid-cols-[360px_1fr] gap-4 flex-1 min-h-0">
          <ScrollArea className="border rounded-lg">
            <div className="p-2 space-y-1">
              {visible.map((c) => (
                <ClusterListItem
                  key={c.id}
                  cluster={c}
                  selected={c.id === effectiveSelectedId}
                  onSelect={() => setSelectedId(c.id)}
                />
              ))}
              {collapsedCount > 0 && (
                <button
                  onClick={() => setExpanded(true)}
                  className="w-full text-left px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
                >
                  + {collapsedCount} more
                </button>
              )}
              {expanded && sorted.length > INITIAL_VISIBLE && (
                <button
                  onClick={() => setExpanded(false)}
                  className="w-full text-left px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
                >
                  Show fewer
                </button>
              )}
              {hiddenCount > 0 && (
                <p className="px-3 py-2 text-[11px] text-muted-foreground">
                  {hiddenCount} one-off group{hiddenCount === 1 ? '' : 's'} hidden — shown once seen
                  again.
                </p>
              )}
            </div>
          </ScrollArea>

          <div className="border rounded-lg overflow-hidden">
            {selected ? (
              <ClusterDetailPane api={api} cluster={selected} />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                Select a pattern to see its sightings.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
