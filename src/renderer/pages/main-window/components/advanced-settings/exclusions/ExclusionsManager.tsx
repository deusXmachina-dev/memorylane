import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Tabs, TabsList, TabsTab, TabsPanel } from '@components/ui/tabs'
import type { ObservationState } from '@types'
import { useMainWindowAPI } from '@/renderer/hooks/use-main-window-api'
import { AppExclusionList } from './AppExclusionList'
import { WebsiteExclusionList } from './WebsiteExclusionList'
import { ObserveButton } from './ObserveButton'
import { ObservationRunningBanner } from './ObservationRunningBanner'

const DEFAULT_DURATION_MS = 120_000

interface ExclusionsManagerProps {
  excludedApps: string[]
  excludedUrlPatterns: string[]
  onAppsChange: (next: string[]) => void
  onUrlsChange: (next: string[]) => void
  onObserved: () => void
}

export function ExclusionsManager({
  excludedApps,
  excludedUrlPatterns,
  onAppsChange,
  onUrlsChange,
  onObserved,
}: ExclusionsManagerProps): React.JSX.Element {
  const api = useMainWindowAPI()
  const [observation, setObservation] = useState<ObservationState | null>(null)
  const [dismissedAppsAt, setDismissedAppsAt] = useState(0)
  const [dismissedUrlsAt, setDismissedUrlsAt] = useState(0)

  useEffect(() => {
    let cancelled = false
    void api.getObservationState().then((initial) => {
      if (cancelled) return
      setObservation(initial)
    })
    const unsubscribe = api.onObservationUpdate((next) => setObservation(next))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [api])

  const lastRun = observation?.lastRun
  const showAppsRecent = lastRun !== undefined && lastRun.at > dismissedAppsAt
  const showUrlsRecent = lastRun !== undefined && lastRun.at > dismissedUrlsAt
  const showAnyRecent = showAppsRecent || showUrlsRecent

  // Notify the page once per run so settings reload.
  const notifiedAtRef = useRef(0)
  useEffect(() => {
    if (!lastRun) return
    if (lastRun.at === notifiedAtRef.current) return
    notifiedAtRef.current = lastRun.at
    onObserved()
  }, [lastRun, onObserved])

  const recentlyAddedApps = showAppsRecent ? (lastRun?.apps ?? []) : []
  const recentlyAddedUrls = showUrlsRecent ? (lastRun?.urls ?? []) : []

  const handleStart = useCallback((): void => {
    void api.startObservation(DEFAULT_DURATION_MS).then((next) => setObservation(next))
  }, [api])

  const handleStop = useCallback((): void => {
    void api.stopObservation().then((next) => setObservation(next))
  }, [api])

  const dismissAppsRecent = useCallback((): void => {
    setDismissedAppsAt(Date.now())
  }, [])

  const dismissUrlsRecent = useCallback((): void => {
    setDismissedUrlsAt(Date.now())
  }, [])

  const banner = useMemo(() => {
    if (observation?.phase === 'running') {
      return <ObservationRunningBanner state={observation} />
    }
    return null
  }, [observation])

  const showTip = observation?.phase !== 'running' && !showAnyRecent

  return (
    <div>
      <Tabs defaultValue="apps">
        <div className="flex items-center justify-between gap-2">
          <TabsList>
            <TabsTab value="apps">Exclude Apps ({excludedApps.length})</TabsTab>
            <TabsTab value="websites">Exclude Websites ({excludedUrlPatterns.length})</TabsTab>
          </TabsList>
          <ObserveButton
            state={observation}
            durationMs={DEFAULT_DURATION_MS}
            onStart={handleStart}
            onStop={handleStop}
          />
        </div>
        {showTip && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Tip: hit <span className="font-medium">Auto-fill from activity</span> and use the apps
            and sites you want blocked. We&apos;ll list them here so you can pick what to block (no
            screenshots taken).
          </p>
        )}
        {banner}
        <TabsPanel value="apps" className="pt-2" keepMounted>
          <AppExclusionList
            excludedApps={excludedApps}
            onChange={onAppsChange}
            recentlyAdded={recentlyAddedApps}
            onDismissRecent={dismissAppsRecent}
          />
        </TabsPanel>
        <TabsPanel value="websites" className="pt-2" keepMounted>
          <WebsiteExclusionList
            excludedUrlPatterns={excludedUrlPatterns}
            onChange={onUrlsChange}
            recentlyAdded={recentlyAddedUrls}
            onDismissRecent={dismissUrlsRecent}
          />
        </TabsPanel>
      </Tabs>
    </div>
  )
}
