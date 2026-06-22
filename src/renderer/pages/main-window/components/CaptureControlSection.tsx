import * as React from 'react'
import { Button } from '@components/ui/button'
import { CAPTURE_PAUSE_CONFIG } from '@/shared/constants'

interface CaptureControlSectionProps {
  capturing: boolean
  toggling: boolean
  onToggle: () => void
  compact?: boolean
  /**
   * Pause feature. When `pausedUntilMs`/`onPause`/`onResume` are provided the
   * control renders the three-state pause UI; otherwise it falls back to the
   * plain Start/Stop toggle (used during onboarding).
   */
  pausedUntilMs?: number | null
  onPause?: (durationMs: number) => void
  onResume?: () => void
}

const PlayIcon = (): React.JSX.Element => (
  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
    <path d="M8 5v14l11-7z" />
  </svg>
)

const StopIcon = (): React.JSX.Element => (
  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
    <rect x="6" y="6" width="12" height="12" rx="1" />
  </svg>
)

const PauseIcon = (): React.JSX.Element => (
  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
)

const formatDuration = (minutes: number): string => (minutes === 60 ? '1 hour' : `${minutes} min`)

const formatCountdown = (remainingMs: number): string => {
  const total = Math.max(0, Math.ceil(remainingMs / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Live MM:SS countdown to `deadlineMs`, recomputed each second. */
function useCountdown(deadlineMs: number | null): string | null {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (deadlineMs === null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [deadlineMs])
  if (deadlineMs === null) return null
  return formatCountdown(deadlineMs - now)
}

export function CaptureControlSection({
  capturing,
  toggling,
  onToggle,
  compact = false,
  pausedUntilMs = null,
  onPause,
  onResume,
}: CaptureControlSectionProps): React.JSX.Element {
  const pauseEnabled = typeof onPause === 'function'
  const isPaused = pauseEnabled && pausedUntilMs !== null
  const countdown = useCountdown(isPaused ? pausedUntilMs : null)

  // Legacy Start/Stop toggle (onboarding, or when pause props are absent).
  if (!pauseEnabled) {
    const label = capturing ? 'Stop Capture' : 'Start Capture'
    return (
      <Button
        className="w-full"
        variant={capturing ? 'destructive' : 'default'}
        size={compact ? 'icon-lg' : 'lg'}
        disabled={toggling}
        onClick={onToggle}
        aria-label={label}
        title={compact ? label : undefined}
      >
        {capturing ? <StopIcon /> : <PlayIcon />}
        {!compact && <span className="ml-2">{label}</span>}
      </Button>
    )
  }

  const defaultPauseMs = CAPTURE_PAUSE_CONFIG.DEFAULT_MINUTES * 60_000

  // Compact (collapsed sidebar): single icon button, no duration menu.
  if (compact) {
    if (isPaused) {
      const label = countdown ? `Resume capture (${countdown})` : 'Resume capture'
      return (
        <Button
          className="w-full"
          variant="default"
          size="icon-lg"
          disabled={toggling}
          onClick={onResume}
          aria-label={label}
          title={label}
        >
          <PlayIcon />
        </Button>
      )
    }
    if (capturing) {
      const label = `Pause capture for ${formatDuration(CAPTURE_PAUSE_CONFIG.DEFAULT_MINUTES)}`
      return (
        <Button
          className="w-full"
          variant="secondary"
          size="icon-lg"
          disabled={toggling}
          onClick={() => onPause?.(defaultPauseMs)}
          aria-label={label}
          title={label}
        >
          <PauseIcon />
        </Button>
      )
    }
    return (
      <Button
        className="w-full"
        variant="default"
        size="icon-lg"
        disabled={toggling}
        onClick={onToggle}
        aria-label="Start Capture"
        title="Start Capture"
      >
        <PlayIcon />
      </Button>
    )
  }

  // Expanded: paused — countdown + resume.
  if (isPaused) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-center text-xs text-muted-foreground">
          Paused — resumes in {countdown ?? '…'}
        </p>
        <Button
          className="w-full"
          variant="default"
          size="lg"
          disabled={toggling}
          onClick={onResume}
        >
          <PlayIcon />
          <span className="ml-2">Resume now</span>
        </Button>
      </div>
    )
  }

  // Expanded: off — start.
  if (!capturing) {
    return (
      <Button className="w-full" variant="default" size="lg" disabled={toggling} onClick={onToggle}>
        <PlayIcon />
        <span className="ml-2">Start Capture</span>
      </Button>
    )
  }

  // Expanded: capturing — primary "Pause for 30 min" + other durations + turn off.
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        className="w-full"
        variant="default"
        size="lg"
        disabled={toggling}
        onClick={() => onPause?.(defaultPauseMs)}
      >
        <PauseIcon />
        <span className="ml-2">
          Pause for {formatDuration(CAPTURE_PAUSE_CONFIG.DEFAULT_MINUTES)}
        </span>
      </Button>
      <div className="flex items-center justify-center gap-1">
        {CAPTURE_PAUSE_CONFIG.PRESETS_MINUTES.filter(
          (m) => m !== CAPTURE_PAUSE_CONFIG.DEFAULT_MINUTES,
        ).map((minutes) => (
          <Button
            key={minutes}
            variant="ghost"
            size="xs"
            disabled={toggling}
            onClick={() => onPause?.(minutes * 60_000)}
          >
            {formatDuration(minutes)}
          </Button>
        ))}
        <Button variant="ghost" size="xs" disabled={toggling} onClick={onToggle}>
          Turn off
        </Button>
      </div>
    </div>
  )
}
