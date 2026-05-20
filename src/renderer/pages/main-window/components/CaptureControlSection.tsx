import * as React from 'react'
import { Button } from '@components/ui/button'

interface CaptureControlSectionProps {
  capturing: boolean
  toggling: boolean
  onToggle: () => void
  compact?: boolean
}

export function CaptureControlSection({
  capturing,
  toggling,
  onToggle,
  compact = false,
}: CaptureControlSectionProps): React.JSX.Element {
  const label = capturing ? 'Stop Capture' : 'Start Capture'
  return (
    <Button
      className="w-full"
      variant={capturing ? 'destructive' : 'default'}
      size={compact ? 'icon' : 'lg'}
      disabled={toggling}
      onClick={onToggle}
      aria-label={label}
      title={compact ? label : undefined}
    >
      {capturing ? (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <rect x="6" y="6" width="12" height="12" rx="1" />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      )}
      {!compact && <span className="ml-2">{label}</span>}
    </Button>
  )
}
