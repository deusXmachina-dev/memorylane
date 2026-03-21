import * as React from 'react'
import { Button } from '@components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'

interface ScreenRecordingSectionProps {
  recording: boolean
  busy: boolean
  recordingsDirectory: string | null
  onToggle: () => void
}

export function ScreenRecordingSection({
  recording,
  busy,
  recordingsDirectory,
  onToggle,
}: ScreenRecordingSectionProps): React.JSX.Element {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Screen Recording</CardTitle>
        <CardDescription>Click once to start. Click again to stop.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button
          className="w-full gap-2"
          variant={recording ? 'destructive' : 'default'}
          size="lg"
          disabled={busy}
          onClick={onToggle}
        >
          {recording ? (
            <>
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
              Stop Recording
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              Start Recording
            </>
          )}
        </Button>

        {recordingsDirectory ? (
          <div className="text-xs text-muted-foreground break-all">
            Saves MP4 to {recordingsDirectory}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
