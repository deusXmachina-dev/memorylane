import { useEffect, useState } from 'react'
import { PingDot } from '@components/ui/ping-dot'
import type { ObservationState } from '@types'

function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${mm}:${ss.toString().padStart(2, '0')}`
}

function useCountdown(endsAt: number | null): number {
  const [secondsRemaining, setSecondsRemaining] = useState(() =>
    endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : 0,
  )
  useEffect(() => {
    if (!endsAt) return
    const compute = (): number => Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
    setSecondsRemaining(compute())
    const interval = setInterval(() => setSecondsRemaining(compute()), 1000)
    return () => clearInterval(interval)
  }, [endsAt])
  return secondsRemaining
}

interface ObservationRunningBannerProps {
  state: ObservationState
}

export function ObservationRunningBanner({
  state,
}: ObservationRunningBannerProps): React.JSX.Element {
  const secondsRemaining = useCountdown(state.endsAt)
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-2 flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs"
    >
      <PingDot />
      <div className="flex-1 leading-snug">
        <span className="font-medium text-foreground">Observing: </span>
        <span className="text-muted-foreground">
          use the apps and websites you want excluded. They&apos;ll be added when the timer ends.
        </span>
      </div>
      <div className="shrink-0 tabular-nums text-muted-foreground">
        {formatCountdown(secondsRemaining)} · {state.appsCount} app
        {state.appsCount === 1 ? '' : 's'} · {state.urlsCount} site
        {state.urlsCount === 1 ? '' : 's'}
      </div>
    </div>
  )
}
