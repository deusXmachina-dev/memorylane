import * as React from 'react'
import { Menu } from '@base-ui/react/menu'
import {
  CaretDownIcon,
  PlayIcon as PlayGlyph,
  PauseIcon as PauseGlyph,
  StopIcon as StopGlyph,
} from '@phosphor-icons/react'
import { Button } from '@components/ui/button'
import { CAPTURE_PAUSE_CONFIG, formatPauseDuration } from '@/shared/constants'

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

// Thin wrappers fix the size/weight once so the call sites stay terse.
const PlayIcon = (): React.JSX.Element => <PlayGlyph className="w-5 h-5" weight="fill" />
const StopIcon = (): React.JSX.Element => <StopGlyph className="w-5 h-5" weight="fill" />
const PauseIcon = (): React.JSX.Element => <PauseGlyph className="w-5 h-5" weight="fill" />

const formatCountdown = (remainingMs: number): string => {
  const minutes = Math.max(0, Math.ceil(remainingMs / 60_000))
  return minutes <= 1 ? '< 1 min' : `${minutes} min`
}

/**
 * Minutes-remaining label until `deadlineMs`, recomputed every 30s. Coarse on
 * purpose: a per-second stopwatch reads as distracting and the changing digit
 * widths make the button jitter, so we round up to whole minutes.
 */
function useCountdown(deadlineMs: number | null): string | null {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (deadlineMs === null) return
    // Refresh immediately: `now` may be stale from mount when the pause starts,
    // which would otherwise over-count by up to one refresh interval (e.g. a
    // 30-min pause briefly reading "31 min").
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 30_000)
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
      const label = `Pause capture for ${formatPauseDuration(CAPTURE_PAUSE_CONFIG.DEFAULT_MINUTES)}`
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

  // Expanded: paused — the play icon is the resume action; the label shows the
  // live auto-resume countdown rather than a redundant "Resume now".
  if (isPaused) {
    return (
      <Button
        className="w-full"
        variant="default"
        size="lg"
        disabled={toggling}
        onClick={onResume}
        aria-label="Resume now"
        title="Resume now"
      >
        <PlayIcon />
        <span className="ml-2 tabular-nums">Resumes in {countdown ?? '…'}</span>
      </Button>
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

  // Expanded: capturing — split button. Primary action pauses for the default
  // duration; a "more" menu holds the other presets and the de-emphasized
  // "Turn off" so stopping capture entirely isn't a one-tap action.
  const otherPresets = CAPTURE_PAUSE_CONFIG.PRESETS_MINUTES.filter(
    (m) => m !== CAPTURE_PAUSE_CONFIG.DEFAULT_MINUTES,
  )
  return (
    <div className="flex w-full gap-px">
      <Button
        className="flex-1 rounded-r-none border-primary"
        variant="default"
        size="lg"
        disabled={toggling}
        onClick={() => onPause?.(defaultPauseMs)}
      >
        <PauseIcon />
        <span className="ml-2">
          Pause for {formatPauseDuration(CAPTURE_PAUSE_CONFIG.DEFAULT_MINUTES)}
        </span>
      </Button>
      <Menu.Root>
        <Menu.Trigger
          render={
            <Button
              variant="default"
              size="lg"
              disabled={toggling}
              aria-label="More capture options"
              className="rounded-l-none border-primary px-2"
            />
          }
        >
          <CaretDownIcon />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
            <Menu.Popup className="min-w-40 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none">
              {otherPresets.map((minutes) => (
                <Menu.Item
                  key={minutes}
                  className="flex cursor-default items-center rounded-md px-2 py-1.5 text-sm outline-none data-highlighted:bg-muted data-highlighted:text-foreground"
                  onClick={() => onPause?.(minutes * 60_000)}
                >
                  Pause for {formatPauseDuration(minutes)}
                </Menu.Item>
              ))}
              <div className="my-1 h-px bg-border" />
              <Menu.Item
                className="flex cursor-default items-center rounded-md px-2 py-1.5 text-sm text-muted-foreground outline-none data-highlighted:bg-muted data-highlighted:text-foreground"
                onClick={onToggle}
              >
                Turn off capture
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  )
}
