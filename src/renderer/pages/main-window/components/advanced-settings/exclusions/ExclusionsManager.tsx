import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ManagedExclusions, ObservationState } from '@types'
import { useMainWindowAPI } from '@/renderer/hooks/use-main-window-api'
import { AppExclusionList } from './AppExclusionList'
import { WebsiteExclusionList } from './WebsiteExclusionList'
import { ObserveButton } from './ObserveButton'
import { ObservationRunningBanner } from './ObservationRunningBanner'
import { HelpTooltip } from './HelpTooltip'

const DEFAULT_DURATION_MS = 120_000
const DISMISSED_APPS_KEY = 'exclusions.dismissedAppsAt'
const DISMISSED_URLS_KEY = 'exclusions.dismissedUrlsAt'

function readDismissedAt(key: string): number {
  try {
    const raw = window.localStorage.getItem(key)
    const parsed = raw === null ? 0 : Number(raw)
    return Number.isFinite(parsed) ? parsed : 0
  } catch {
    return 0
  }
}

function writeDismissedAt(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // storage unavailable — dismissal will just not persist across reopens
  }
}

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
  const [managed, setManaged] = useState<ManagedExclusions>({ apps: [], urlPatterns: [] })
  const [dismissedAppsAt, setDismissedAppsAt] = useState(() => readDismissedAt(DISMISSED_APPS_KEY))
  const [dismissedUrlsAt, setDismissedUrlsAt] = useState(() => readDismissedAt(DISMISSED_URLS_KEY))

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

  // Org-provided exclusions are pushed when IT edits them; fetch once and keep
  // in sync so the locked rows reflect the current tenant policy live.
  useEffect(() => {
    let cancelled = false
    void api.getManagedExclusions().then((initial) => {
      if (cancelled) return
      setManaged(initial)
    })
    const unsubscribe = api.onManagedExclusionsUpdate((next) => setManaged(next))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [api])

  const lastRun = observation?.lastRun
  const showFoundApps = lastRun !== undefined && lastRun.at > dismissedAppsAt
  const showFoundUrls = lastRun !== undefined && lastRun.at > dismissedUrlsAt

  // Notify the page once per run so settings reload.
  const notifiedAtRef = useRef(0)
  useEffect(() => {
    if (!lastRun) return
    if (lastRun.at === notifiedAtRef.current) return
    notifiedAtRef.current = lastRun.at
    onObserved()
  }, [lastRun, onObserved])

  const foundApps = showFoundApps ? (lastRun?.apps ?? []) : []
  const foundUrls = showFoundUrls ? (lastRun?.urls ?? []) : []

  const handleStart = useCallback((): void => {
    void api.startObservation(DEFAULT_DURATION_MS).then((next) => setObservation(next))
  }, [api])

  const handleStop = useCallback((): void => {
    void api.stopObservation().then((next) => setObservation(next))
  }, [api])

  const dismissFoundApps = useCallback((): void => {
    const now = Date.now()
    setDismissedAppsAt(now)
    writeDismissedAt(DISMISSED_APPS_KEY, now)
  }, [])

  const dismissFoundUrls = useCallback((): void => {
    const now = Date.now()
    setDismissedUrlsAt(now)
    writeDismissedAt(DISMISSED_URLS_KEY, now)
  }, [])

  const banner = useMemo(() => {
    if (observation?.phase === 'running') {
      return <ObservationRunningBanner state={observation} />
    }
    return null
  }, [observation])

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium text-foreground">Block apps &amp; websites</p>
            <HelpTooltip label="What blocking covers" width="w-72">
              Blocking follows the window you&apos;re in. MemoryLane sees the whole screen, so a
              blocked app or site can still show up in the background, or for a moment while you
              switch windows.
            </HelpTooltip>
          </div>
          <p className="text-xs text-muted-foreground">
            Skip these entirely — never captured, never analysed.
          </p>
        </div>
        <ObserveButton
          state={observation}
          durationMs={DEFAULT_DURATION_MS}
          onStart={handleStart}
          onStop={handleStop}
        />
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-muted/10 p-4">
        {banner}
        <div className="grid grid-cols-2 divide-x divide-border">
          <div className="pr-4">
            <AppExclusionList
              excludedApps={excludedApps}
              onChange={onAppsChange}
              found={foundApps}
              onDismissFound={dismissFoundApps}
              managed={managed.apps}
            />
          </div>
          <div className="pl-4">
            <WebsiteExclusionList
              excludedUrlPatterns={excludedUrlPatterns}
              onChange={onUrlsChange}
              found={foundUrls}
              onDismissFound={dismissFoundUrls}
              managed={managed.urlPatterns}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
