import * as React from 'react'
import { Button } from '@components/ui/button'

interface CaptureControlSectionProps {
  capturing: boolean
  captureHotkeyLabel: string
  toggling: boolean
  onToggle: () => void
}

export function CaptureControlSection({
  capturing,
  captureHotkeyLabel,
  toggling,
  onToggle,
}: CaptureControlSectionProps): React.JSX.Element {
  return (
    <Button
      className="w-full gap-2"
      variant={capturing ? 'destructive' : 'default'}
      size="lg"
      disabled={toggling}
      onClick={onToggle}
    >
      {capturing ? (
        <>
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
          Stop Capture
        </>
      ) : (
        <>
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
          Start Capture
        </>
      )}
      {captureHotkeyLabel && (
        <span className="ml-auto flex items-center gap-0.5">
          {captureHotkeyLabel.split('+').map((key) => (
            <kbd
              key={key}
              className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-current/20 bg-current/10 px-1 text-[10px] font-medium"
            >
              {key}
            </kbd>
          ))}
        </span>
      )}
    </Button>
  )
}
