import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { Button } from '@components/ui/button'
import { cn } from '@/renderer/lib/utils'
import { OnboardingStep } from './OnboardingStep'
import type { MainWindowAPI, PermissionKind, PermissionState, PermissionStatus } from '@types'

interface PermissionsStepProps {
  api: MainWindowAPI
}

interface PermissionInfo {
  kind: PermissionKind
  title: string
  description: string
}

const PERMISSIONS: PermissionInfo[] = [
  {
    kind: 'accessibility',
    title: 'Accessibility',
    description: 'So MemoryLane can notice when you switch apps and type, to tell tasks apart.',
  },
  {
    kind: 'screenRecording',
    title: 'Screen Recording',
    description: 'So MemoryLane can capture screenshots to recognise what you were working on.',
  },
]

interface ReassurancePoint {
  title: string
  body: string
}

const REASSURANCE: ReassurancePoint[] = [
  {
    title: 'No keystrokes saved',
    body: 'We track typing duration, not what you type.',
  },
  {
    title: 'Stays on device',
    body: 'After inference, screenshots and activity stay on your machine.',
  },
  {
    title: 'Pause anytime',
    body: 'Stop capturing from the menu bar.',
  },
  {
    title: 'Exclude apps',
    body: 'Block specific apps from capture.',
  },
]

interface PermissionRowProps {
  info: PermissionInfo
  index: number
  granted: boolean
  onGrant: () => void
}

function PermissionRow({ info, index, granted, onGrant }: PermissionRowProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-lg border bg-card p-4 transition-colors',
        granted ? 'border-primary/40' : 'border-border',
      )}
    >
      <div
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
          granted ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground',
        )}
        aria-hidden
      >
        {granted ? <Check className="size-4" strokeWidth={2.5} /> : index + 1}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">{info.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground leading-snug">{info.description}</p>
      </div>
      {granted ? (
        <span className="text-xs font-medium text-primary">Granted</span>
      ) : (
        <Button size="sm" onClick={onGrant}>
          Grant
        </Button>
      )}
    </div>
  )
}

export function PermissionsStep({ api }: PermissionsStepProps): React.JSX.Element {
  const [status, setStatus] = useState<PermissionStatus | null>(null)
  // Captured once on first load so we can tell if screen recording was granted
  // mid-session. macOS won't actually let the running process capture until it
  // restarts, so in that case we gate the step on a manual restart.
  const [initialScreenRecording, setInitialScreenRecording] = useState<PermissionState | null>(null)

  useEffect(() => {
    void api.getPermissionStatus().then(setStatus)
    const unsubscribe = api.onPermissionStatusChanged(setStatus)
    return () => unsubscribe()
  }, [api])

  useEffect(() => {
    if (status !== null && initialScreenRecording === null) {
      setInitialScreenRecording(status.screenRecording)
    }
  }, [status, initialScreenRecording])

  const needsRestart =
    initialScreenRecording !== null &&
    initialScreenRecording !== 'granted' &&
    status?.screenRecording === 'granted'

  const handleGrant = useCallback(
    (kind: PermissionKind) => {
      // Fire-and-forget: the IPC handler opens System Settings and starts
      // polling. We deliberately don't gate the button on a `pending` state —
      // doing so caused a Grant → Opening… → Grant flicker for the ~150ms
      // round-trip before the row eventually flips to "Granted" via polling.
      void api.requestPermission(kind).then(setStatus)
    },
    [api],
  )

  const handleRestart = useCallback(() => {
    void api.restartApp()
  }, [api])

  if (status === null) return <div />

  const grantedCount =
    (status.accessibility === 'granted' ? 1 : 0) + (status.screenRecording === 'granted' ? 1 : 0)
  const allGranted = grantedCount === 2

  if (allGranted && needsRestart) {
    return (
      <OnboardingStep>
        <OnboardingStep.Header
          title="One more thing"
          subtitle="Both permissions are granted. MemoryLane needs to restart for Screen Recording to take effect."
        />
        <div className="pt-2">
          <Button size="lg" onClick={handleRestart}>
            Restart & Continue
          </Button>
        </div>
      </OnboardingStep>
    )
  }

  return (
    <OnboardingStep>
      <OnboardingStep.Header
        title="Grant 2 permissions"
        subtitle={
          <>
            MemoryLane needs both Accessibility and Screen Recording to capture your activity.{' '}
            <span className="text-foreground">{grantedCount} of 2 granted.</span>
          </>
        }
      />

      <div className="flex items-start gap-3 rounded-lg border border-primary/60 bg-primary/10 p-4">
        <RotateCcw className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-semibold text-foreground">Already granted?</p>
          <p className="text-xs text-muted-foreground">
            MemoryLane must restart before the permissions take effect.
          </p>
        </div>
        <Button size="sm" onClick={handleRestart}>
          Restart MemoryLane
        </Button>
      </div>

      <div className="space-y-3">
        {PERMISSIONS.map((info, idx) => (
          <PermissionRow
            key={info.kind}
            info={info}
            index={idx}
            granted={status[info.kind] === 'granted'}
            onGrant={() => handleGrant(info.kind)}
          />
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {REASSURANCE.map((p) => (
            <div key={p.title} className="flex gap-2">
              <div className="pt-0.5">
                <Check className="size-4 shrink-0 text-primary" strokeWidth={2.5} />
              </div>
              <div className="space-y-0.5">
                <p className="text-sm font-medium leading-tight">{p.title}</p>
                <p className="text-xs text-muted-foreground leading-snug">{p.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </OnboardingStep>
  )
}
