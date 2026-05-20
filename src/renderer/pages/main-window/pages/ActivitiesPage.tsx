import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@components/ui/button'
import { Card } from '@components/ui/card'
import type { MainWindowAPI, RecentActivity } from '@types'

const PAGE_SIZE = 100

function formatTimestamp(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ActivityRow({ activity }: { activity: RecentActivity }): React.JSX.Element {
  const subtitle = activity.tld ? `${activity.appName} · ${activity.tld}` : activity.appName
  return (
    <Card className="px-3 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-medium truncate">
          {activity.windowTitle || activity.summary || activity.appName}
        </div>
        <div className="text-xs text-muted-foreground shrink-0">
          {formatTimestamp(activity.startTimestamp)}
        </div>
      </div>
      <div className="text-xs text-muted-foreground truncate mt-0.5">{subtitle}</div>
      {activity.summary && activity.summary !== activity.windowTitle && (
        <div className="text-xs text-muted-foreground/90 mt-1 line-clamp-2">{activity.summary}</div>
      )}
    </Card>
  )
}

interface ActivitiesPageProps {
  api: MainWindowAPI
}

export function ActivitiesPage({ api }: ActivitiesPageProps): React.JSX.Element {
  const [items, setItems] = useState<RecentActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

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

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">Activities</h1>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No activities yet. Start capture to begin recording.
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {items.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center pt-2">
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
        </>
      )}
    </div>
  )
}
