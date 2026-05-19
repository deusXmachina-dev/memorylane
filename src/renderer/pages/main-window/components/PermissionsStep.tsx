import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@components/ui/button'
import { cn } from '@/renderer/lib/utils'
import type { MainWindowAPI, PermissionKind, PermissionStatus } from '@types'

interface PermissionsStepProps {
  api: MainWindowAPI
  onAllGranted: () => void
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

function CheckIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      className={cn('size-4 shrink-0', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

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
        {granted ? <CheckIcon className="size-4" /> : index + 1}
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

export function PermissionsStep({ api, onAllGranted }: PermissionsStepProps): React.JSX.Element {
  const [status, setStatus] = useState<PermissionStatus | null>(null)

  useEffect(() => {
    void api.getPermissionStatus().then(setStatus)
    const unsubscribe = api.onPermissionStatusChanged(setStatus)
    return () => unsubscribe()
  }, [api])

  useEffect(() => {
    if (
      status !== null &&
      status.accessibility === 'granted' &&
      status.screenRecording === 'granted'
    ) {
      onAllGranted()
    }
  }, [status, onAllGranted])

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

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Grant 2 permissions</h1>
        <p className="text-sm text-muted-foreground">
          MemoryLane needs both Accessibility and Screen Recording to capture your activity.{' '}
          <span className="text-foreground">{grantedCount} of 2 granted.</span>
        </p>
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
                <CheckIcon className="text-primary" />
              </div>
              <div className="space-y-0.5">
                <p className="text-sm font-medium leading-tight">{p.title}</p>
                <p className="text-xs text-muted-foreground leading-snug">{p.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Already granted?{' '}
        <button
          type="button"
          onClick={handleRestart}
          className="text-foreground underline-offset-2 hover:underline"
        >
          Restart MemoryLane
        </button>{' '}
        to apply.
      </p>
    </div>
  )
}
