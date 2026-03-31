import { CaptureControlSection } from './CaptureControlSection'
import { PATTERN_DETECTION_CONFIG } from '@constants'
import type { MainWindowAPI } from '@types'

interface CaptureStepProps {
  api: MainWindowAPI
  capturing: boolean
  captureHotkeyLabel: string
  toggling: boolean
  onToggle: () => void
  activityCount: number | null
}

export function CaptureStep({
  api,
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
      </div>

      <CaptureControlSection
        capturing={capturing}
        captureHotkeyLabel={captureHotkeyLabel}
        toggling={toggling}
        onToggle={onToggle}
      />

      {capturing && (
        <div className="rounded-lg bg-secondary/50 p-3 space-y-1">
          <p className="text-xs font-medium">You&apos;re all set - come back tomorrow!</p>
          <p className="text-xs text-muted-foreground">
            Meanwhile, install our{' '}
            <a
              href="https://trymemorylane.com/guide#add-skills"
              className="underline hover:text-foreground"
              onClick={(e) => {
                e.preventDefault()
                api.openExternal('https://trymemorylane.com/guide#add-skills')
              }}
            >
              Claude Cowork plugin
            </a>{' '}
            for the best experience.
          </p>
        </div>
      )}
    </div>
  )
}
