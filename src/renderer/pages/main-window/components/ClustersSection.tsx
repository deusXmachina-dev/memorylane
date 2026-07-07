import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { ScrollArea } from '@components/ui/scroll-area'
import type { ClusterInfo, MainWindowAPI } from '@types'
import { ClusterListItem } from './ClusterListItem'
import { ClusterDetailPane } from './ClusterDetailPane'

const SORTS = [
  { id: 'seen', label: 'Most seen' },
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
}

export function ClustersSection({
  api,
  clusters,
  hiddenCount,
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
        copy.sort((a, b) => b.avgSpanMin - a.avgSpanMin)
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

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
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
        <span className="ml-auto text-xs text-muted-foreground">{clusters.length} found</span>
      </div>

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
