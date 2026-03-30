import { CaptureControlSection } from './CaptureControlSection'
import { PATTERN_DETECTION_CONFIG } from '@constants'

interface CaptureStepProps {
  capturing: boolean
  captureHotkeyLabel: string
  toggling: boolean
  onToggle: () => void
  activityCount: number | null
}

export function CaptureStep({
  capturing,
  captureHotkeyLabel,
  toggling,
  onToggle,
  activityCount,
}: CaptureStepProps): React.JSX.Element {
  const minActivities = PATTERN_DETECTION_CONFIG.MIN_ACTIVITIES
  const safeCount = activityCount ?? 0
  const progressPercent = Math.min(100, Math.round((safeCount / minActivities) * 100))

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">
          {capturing ? 'Analyzing your activity...' : 'Start capturing'}
        </h2>
        <p className="text-xs text-muted-foreground">
          {capturing
            ? 'Keep MemoryLane running. First patterns appear in about a day.'
            : 'MemoryLane captures your screen activity to find repetitive patterns. First results appear in about a day.'}
        </p>
        {capturing && activityCount !== null && activityCount > 0 && (
          <div className="space-y-1 pt-1">
            <div className="h-2 w-full rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-primary transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {progressPercent}% &middot; {safeCount} / ~{minActivities} activities
            </p>
          </div>
        )}
      </div>

      <CaptureControlSection
        capturing={capturing}
        captureHotkeyLabel={captureHotkeyLabel}
        toggling={toggling}
        onToggle={onToggle}
      />
    </div>
  )
}
