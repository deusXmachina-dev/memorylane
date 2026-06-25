import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { Tabs, TabsList, TabsTab, TabsPanel } from '@components/ui/tabs'
import type { ManagedExclusions, ObservationState } from '@types'
import { useMainWindowAPI } from '@/renderer/hooks/use-main-window-api'
import { AppExclusionList } from './AppExclusionList'
import { WebsiteExclusionList } from './WebsiteExclusionList'
import { ObserveButton } from './ObserveButton'
import { ObservationRunningBanner } from './ObservationRunningBanner'

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
  layout?: 'tabbed' | 'stacked'
}

export function ExclusionsManager({
  excludedApps,
  excludedUrlPatterns,
  onAppsChange,
  onUrlsChange,
  onObserved,
  layout = 'tabbed',
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

  if (layout === 'stacked') {
    return (
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium text-foreground">Block apps & websites</p>
              <span
                tabIndex={0}
                role="button"
                aria-label="About privacy filtering"
                className="group relative inline-flex rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <HelpCircle
                  aria-hidden="true"
                  className="size-3.5 cursor-help text-muted-foreground"
                />
                <span
                  role="tooltip"
                  className="pointer-events-none absolute top-full left-0 z-10 mt-1 w-72 rounded-md border border-border bg-popover px-2.5 py-2 text-[11px] leading-snug text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  Privacy filtering is best-effort. Because MemoryLane captures the whole screen, a
                  blocked app or site may still appear in screenshots if it&apos;s visible in the
                  background, during a window switch, or briefly during transitions.
                </span>
              </span>
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
        {banner}

        <div className="space-y-0.5">
          <p className="text-sm font-medium text-foreground">Blacklisted apps</p>
        </div>
        <AppExclusionList
          excludedApps={excludedApps}
          onChange={onAppsChange}
          found={foundApps}
          onDismissFound={dismissFoundApps}
          managed={managed.apps}
        />

        <div className="space-y-0.5">
          <p className="text-sm font-medium text-foreground">Blacklisted websites</p>
          <p className="text-xs text-muted-foreground">URL patterns that will never be captured.</p>
        </div>
        <WebsiteExclusionList
          excludedUrlPatterns={excludedUrlPatterns}
          onChange={onUrlsChange}
          found={foundUrls}
          onDismissFound={dismissFoundUrls}
          managed={managed.urlPatterns}
        />
      </div>
    )
  }

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
        {banner}
        <TabsPanel value="apps" className="pt-2" keepMounted>
          <AppExclusionList
            excludedApps={excludedApps}
            onChange={onAppsChange}
            found={foundApps}
            onDismissFound={dismissFoundApps}
            managed={managed.apps}
          />
        </TabsPanel>
        <TabsPanel value="websites" className="pt-2" keepMounted>
          <WebsiteExclusionList
            excludedUrlPatterns={excludedUrlPatterns}
            onChange={onUrlsChange}
            found={foundUrls}
            onDismissFound={dismissFoundUrls}
            managed={managed.urlPatterns}
          />
        </TabsPanel>
      </Tabs>
    </div>
  )
}
