import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActivityDetail, ActivityDigest, MainWindowAPI } from '@types'

export const ACTIVITIES_PAGE_SIZE = 200
const REFRESH_THROTTLE_MS = 4_000

export interface ActivitiesData {
  digest: ActivityDigest | null
  items: ActivityDetail[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  query: string
  setQuery: (q: string) => void
  appFilter: string | null
  setAppFilter: (app: string | null) => void
  loadMore: () => Promise<void>
  refresh: () => Promise<void>
  ensureLoaded: () => void
}

function sameItemSequence(a: ActivityDetail[], b: ActivityDetail[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false
  }
  return true
}

function sameDigest(a: ActivityDigest | null, b: ActivityDigest | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.totalCount === b.totalCount &&
    a.dateRange.oldest === b.dateRange.oldest &&
    a.dateRange.newest === b.dateRange.newest &&
    a.topApps.length === b.topApps.length &&
    a.topApps.every(
      (row, i) => row.appName === b.topApps[i].appName && row.count === b.topApps[i].count,
    )
  )
}

export function useActivitiesData(api: MainWindowAPI): ActivitiesData {
  const [digest, setDigest] = useState<ActivityDigest | null>(null)
  const [items, setItems] = useState<ActivityDetail[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [query, setQuery] = useState('')
  const [appFilter, setAppFilter] = useState<string | null>(null)

  const loadedRef = useRef(false)
  const lastRefreshRef = useRef(0)
  const inflightRef = useRef<Promise<void> | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const fetchFirstPage = useCallback(async () => {
    try {
      const rows = await api.listRecentActivities(ACTIVITIES_PAGE_SIZE, 0)
      if (!mountedRef.current) return
      setItems((prev) => (sameItemSequence(prev, rows) ? prev : rows))
      setHasMore(rows.length === ACTIVITIES_PAGE_SIZE)
    } catch (err) {
      console.warn('[activities] listRecentActivities failed', err)
    }
  }, [api])

  const fetchDigest = useCallback(async () => {
    try {
      const d = await api.getActivityDigest()
      if (!mountedRef.current) return
      setDigest((prev) => (sameDigest(prev, d) ? prev : d))
    } catch (err) {
      console.warn('[activities] getActivityDigest failed', err)
    }
  }, [api])

  const ensureLoaded = useCallback(() => {
    if (loadedRef.current || inflightRef.current) return
    loadedRef.current = true
    setLoading(true)
    const initial = Promise.all([fetchDigest(), fetchFirstPage()]).then(() => {
      lastRefreshRef.current = Date.now()
      inflightRef.current = null
      if (mountedRef.current) setLoading(false)
    })
    inflightRef.current = initial
  }, [fetchDigest, fetchFirstPage])

  // Resolves on "system is now idle", not on "data was refetched": a throttled
  // call can return Promise.resolve() without refetching.
  const refresh = useCallback((): Promise<void> => {
    if (!loadedRef.current) return Promise.resolve()
    if (inflightRef.current) return inflightRef.current
    if (Date.now() - lastRefreshRef.current < REFRESH_THROTTLE_MS) return Promise.resolve()
    const run = Promise.all([fetchDigest(), fetchFirstPage()]).then(() => {
      lastRefreshRef.current = Date.now()
      inflightRef.current = null
    })
    inflightRef.current = run
    return run
  }, [fetchDigest, fetchFirstPage])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const next = await api.listRecentActivities(ACTIVITIES_PAGE_SIZE, items.length)
      if (!mountedRef.current) return
      setItems((prev) => [...prev, ...next])
      setHasMore(next.length === ACTIVITIES_PAGE_SIZE)
    } catch (err) {
      console.warn('[activities] listRecentActivities (loadMore) failed', err)
    } finally {
      if (mountedRef.current) setLoadingMore(false)
    }
  }, [api, items.length, hasMore, loadingMore])

  return {
    digest,
    items,
    loading,
    loadingMore,
    hasMore,
    query,
    setQuery,
    appFilter,
    setAppFilter,
    loadMore,
    refresh,
    ensureLoaded,
  }
}
