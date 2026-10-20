import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { PingDot } from '@components/ui/ping-dot'
import { ScrollArea } from '@components/ui/scroll-area'
import type { ClusterInfo, MainWindowAPI, MiningFailureKind, MiningStatus } from '@types'
import { ClusterListItem } from './ClusterListItem'
import { ClusterDetailPane } from './ClusterDetailPane'

function MiningProgressBanner({ status }: { status: MiningStatus }): React.JSX.Element {
  const done = status.completedDays + status.failedDays
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="flex min-w-0 items-center gap-2 font-medium text-foreground/85">
        <PingDot active />
        <span className="truncate">Analyzing your history</span>
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {done} of {status.totalDays} days
      </span>
    </div>
  )
}

const FAILURE_HINTS: Record<MiningFailureKind, string | null> = {
  auth: 'Your API key was rejected.',
  quota: 'Your AI provider account is out of credit.',
  model: "The selected model isn't available from your provider.",
  output: 'The model returned unusable results. Try a stronger model.',
  other: null,
}

function MiningFailureBanner({
  api,
  failure,
  onOpenAiSettings,
}: {
  api: MainWindowAPI
  failure: NonNullable<MiningStatus['failure']>
  onOpenAiSettings?: () => void
}): React.JSX.Element {
  const [retrying, setRetrying] = useState(false)
  const hint = FAILURE_HINTS[failure.kind]
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-2">
      <div className="space-y-1">
        <p className="text-sm font-medium text-destructive">Task discovery is failing</p>
        {hint && <p className="text-xs text-foreground/85">{hint}</p>}
        <p className="text-[11px] text-muted-foreground break-words">{failure.message}</p>
      </div>
      <div className="flex gap-2">
        {onOpenAiSettings && (
          <Button size="sm" variant="secondary" onClick={onOpenAiSettings}>
            AI settings
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          disabled={retrying}
          onClick={() => {
            setRetrying(true)
            api
              .retryFailedMiningDays()
              .catch(() => toast.error('Retry failed'))
              .finally(() => setRetrying(false))
          }}
        >
          Retry now
        </Button>
      </div>
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
  onOpenAiSettings?: () => void
}

export function ClustersSection({
  api,
  clusters,
  hiddenCount,
  miningStatus,
  onOpenAiSettings,
}: ClustersSectionProps): React.JSX.Element {
  const [sort, setSort] = useState<SortId>('seen')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [detectionEnabled, setDetectionEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    api
      .getAppSettings()
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
            api.saveAppSettings({ patternDetectionEnabled: true }).then((result) => {
              if (result.success) toast.success('Task discovery enabled')
            })
          }}
        >
          Start discovering
        </Button>
      </div>
    )
  }

  const failure = miningStatus?.failure ?? null
  const miningActive =
    failure === null &&
    miningStatus !== null &&
    miningStatus.totalDays > 0 &&
    (miningStatus.state === 'mining' || miningStatus.pendingDays > 0)

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      {failure && (
        <MiningFailureBanner api={api} failure={failure} onOpenAiSettings={onOpenAiSettings} />
      )}
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
          {failure
            ? 'No patterns yet.'
            : hiddenCount > 0
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
