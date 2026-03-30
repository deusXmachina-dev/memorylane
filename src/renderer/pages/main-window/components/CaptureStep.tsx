import { CaptureControlSection } from './CaptureControlSection'

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
          <p className="text-xs text-muted-foreground">{activityCount} activities recorded</p>
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
