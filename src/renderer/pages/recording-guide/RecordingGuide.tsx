import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@components/ui/button'
import { useMainWindowAPI } from '@/renderer/hooks/use-main-window-api'
import {
  isHandsOffStep,
  type EvalRecordingStatus,
  type RecordingScript,
} from '@/shared/eval-review'
import { cn } from '@/renderer/lib/utils'
import { formatClock, stepProgress } from '@/renderer/lib/recording-steps'

type Busy = 'saving' | 'restarting' | 'canceling' | null

export function RecordingGuide(): React.JSX.Element | null {
  const api = useMainWindowAPI()
  const [status, setStatus] = useState<EvalRecordingStatus | null>(null)
  const [scripts, setScripts] = useState<RecordingScript[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<Busy>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void api.evalListScripts().then(setScripts)
    const tick = (): void => {
      setNow(Date.now())
      void api.evalRecordingStatus().then(setStatus)
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [api])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new ResizeObserver(() => api.evalResizeGuide(root.offsetHeight))
    observer.observe(root)
    return () => observer.disconnect()
  }, [api])

  const script = scripts.find((s) => s.id === status?.scriptId) ?? null
  const elapsedMs = status?.startedAt ? now - status.startedAt : 0
  const progress = script ? stepProgress(script.steps, elapsedMs) : null
  const lastStep = script?.steps[script.steps.length - 1]
  const autoStops = lastStep ? isHandsOffStep(lastStep) : false

  const done = useCallback(async () => {
    setBusy('saving')
    await api.evalStopRecording()
  }, [api])

  const restart = useCallback(async () => {
    setBusy('restarting')
    await api.evalRestartRecording()
    setBusy(null)
  }, [api])

  const cancel = useCallback(async () => {
    setBusy('canceling')
    await api.evalCancelRecording()
  }, [api])

  useEffect(() => {
    if (autoStops && progress?.finished && busy === null) void done()
  }, [autoStops, progress?.finished, busy, done])

  return (
    <div ref={rootRef} className="space-y-3 border bg-background p-4 text-foreground select-none">
      <div className="flex items-center gap-2 text-sm [-webkit-app-region:drag]">
        <span className="size-2 rounded-full bg-destructive" />
        <span className="flex-1 font-medium">
          {busy === 'saving'
            ? 'Saving recording…'
            : script && progress
              ? `Recording · step ${Math.min(progress.index + 1, script.steps.length)} of ${script.steps.length}`
              : 'Recording'}
        </span>
        <span className="tabular-nums text-muted-foreground">{formatClock(elapsedMs)}</span>
      </div>

      {script && progress && (
        <ol className="space-y-2">
          {script.steps.map((step, i) => {
            const current = i === progress.index
            return (
              <li
                key={i}
                className={cn(
                  i < progress.index && 'text-xs text-muted-foreground line-through',
                  current && 'text-base leading-snug font-medium',
                  i > progress.index && 'text-xs text-muted-foreground',
                )}
              >
                {i + 1}. {step.instruction}
                {current && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary transition-[width] duration-500"
                        style={{ width: `${Math.round(progress.fraction * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-normal tabular-nums text-muted-foreground">
                      ~{progress.secondsLeft}s left
                    </span>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}

      {script && progress?.finished && !autoStops && (
        <p className="text-sm">All steps done. Press Done.</p>
      )}
      {autoStops && !progress?.finished && (
        <p className="text-xs text-muted-foreground">Stops by itself when the timer ends.</p>
      )}

      <div className="flex gap-2">
        {script && (
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => void restart()}
            disabled={busy !== null}
          >
            Restart
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="flex-1"
          onClick={() => void cancel()}
          disabled={busy !== null}
        >
          Cancel
        </Button>
        <Button size="sm" className="flex-1" onClick={() => void done()} disabled={busy !== null}>
          Done
        </Button>
      </div>
    </div>
  )
}
