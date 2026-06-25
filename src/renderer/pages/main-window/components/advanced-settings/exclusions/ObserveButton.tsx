import { Square, Target } from 'lucide-react'
import { Button } from '@components/ui/button'
import type { ObservationState } from '@types'

interface ObserveButtonProps {
  state: ObservationState | null
  durationMs: number
  onStart: () => void
  onStop: () => void
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`
  const minutes = Math.round(totalSeconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

export function ObserveButton({
  state,
  durationMs,
  onStart,
  onStop,
}: ObserveButtonProps): React.JSX.Element {
  const running = state?.phase === 'running'

  if (running) {
    return (
      <Button variant="destructive" size="sm" onClick={onStop}>
        <Square className="fill-current" />
        Stop
      </Button>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onStart}
      title={`Watch which apps and sites you use for ${formatDuration(durationMs)} (no screenshots), then add them to exclusions.`}
    >
      <Target />
      Auto-fill from activity
    </Button>
  )
}
