import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@components/ui/button'
import { OnboardingCard } from './OnboardingCard'
import { OnboardingStep } from './OnboardingStep'
import type { MainWindowAPI, PermissionKind, PermissionState, PermissionStatus } from '@types'

interface PermissionsStepProps {
  api: MainWindowAPI
  onContinue: () => void
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
    title: 'Stored on device',
    body: 'Activity and patterns stay local. Screenshots only leave the device for the AI provider you pick.',
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
    <OnboardingCard
      tone={granted ? 'success' : 'default'}
      icon={
        granted ? (
          <Check className="size-4" strokeWidth={2.5} />
        ) : (
          <span className="text-sm font-semibold">{index + 1}</span>
        )
      }
      title={info.title}
      description={info.description}
      action={
        granted ? (
          <span className="text-xs font-medium text-primary">Granted</span>
        ) : (
          <Button size="sm" onClick={onGrant}>
            Grant
          </Button>
        )
      }
    />
  )
}

export function PermissionsStep({ api, onContinue }: PermissionsStepProps): React.JSX.Element {
  const [status, setStatus] = useState<PermissionStatus | null>(null)
  // Captured synchronously on the first non-null status so we can tell if
  // screen recording was granted mid-session. macOS won't actually let the
  // running process capture until it restarts, so in that case we gate the
  // step on a manual restart. Ref (not state) so the value is visible on the
  // same render that first sets `status`, avoiding a one-frame window where
  // `needsRestart` would falsely read false.
  const initialScreenRecordingRef = useRef<PermissionState | null>(null)

  const handleStatus = useCallback((next: PermissionStatus) => {
    if (initialScreenRecordingRef.current === null) {
      initialScreenRecordingRef.current = next.screenRecording
    }
    setStatus(next)
  }, [])

  useEffect(() => {
    void api.getPermissionStatus().then(handleStatus)
    const unsubscribe = api.onPermissionStatusChanged(handleStatus)
    return () => unsubscribe()
  }, [api, handleStatus])

  const initialScreenRecording = initialScreenRecordingRef.current
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
      void api.requestPermission(kind).then(handleStatus)
    },
    [api, handleStatus],
  )

  const handleRestart = useCallback(() => {
    void api.restartApp()
  }, [api])

  if (status === null) return <div />

  const grantedCount =
    (status.accessibility === 'granted' ? 1 : 0) + (status.screenRecording === 'granted' ? 1 : 0)
  const allGranted = grantedCount === 2

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

      <div className="pt-2">
        <Button
          size="lg"
          disabled={!allGranted}
          onClick={needsRestart ? handleRestart : onContinue}
        >
          {needsRestart ? 'Restart MemoryLane' : 'Continue'}
        </Button>
      </div>
    </OnboardingStep>
  )
}
