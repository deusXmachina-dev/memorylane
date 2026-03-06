import * as React from 'react'
import { Button } from '@components/ui/button'
import { Card, CardContent } from '@components/ui/card'

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
    <Card>
      <CardContent>
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
        </Button>
        {captureHotkeyLabel ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Capture hotkey (start/stop): {captureHotkeyLabel}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
