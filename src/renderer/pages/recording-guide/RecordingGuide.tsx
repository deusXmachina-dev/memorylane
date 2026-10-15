import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@components/ui/button'
import { useMainWindowAPI } from '@/renderer/hooks/use-main-window-api'
import type { EvalRecordingStatus, RecordingScript } from '@/shared/eval-review'
import { cn } from '@/renderer/lib/utils'
import { formatClock, stepState, stepTarget, type StepState } from '@/renderer/lib/recording-steps'

type Busy = 'saving' | 'restarting' | 'canceling' | null

function stepHint(script: RecordingScript, state: StepState, started: boolean): string {
  if (!started) return `go to: ${stepTarget(script.steps[0])}`
  const reached = `✓ ${stepTarget(script.steps[state.index])}`
  if (state.secondsLeft !== null) {
    const last = state.index === script.steps.length - 1
    return `${reached} · hands off ~${state.secondsLeft}s${last ? ', then saves by itself' : ''}`
  }
  const next = script.steps[state.index + 1]
  return next
    ? `${reached} · when done, go to: ${stepTarget(next)}`
    : `${reached} · last step, press Done when finished`
}

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
  const enteredAt = status?.stepEnteredAt ?? []
  const state = script ? stepState(script.steps, enteredAt, now) : null
  const saving = busy === 'saving' || (status?.saving ?? false)
  const elapsedMs = status?.startedAt ? now - status.startedAt : 0

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
    if (state?.finished && busy === null && !status?.saving) void done()
  }, [state?.finished, busy, status?.saving, done])

  const locked = busy !== null || saving

  return (
    <div ref={rootRef} className="space-y-3 border bg-background p-4 text-foreground select-none">
      <div className="flex items-center gap-2 text-sm [-webkit-app-region:drag]">
        <span className="size-2 rounded-full bg-destructive" />
        <span className="flex-1 font-medium">
          {saving
            ? 'Saving recording…'
            : script && state
              ? `Recording · step ${state.index + 1} of ${script.steps.length}`
              : 'Recording'}
        </span>
        {!saving && (
          <span className="tabular-nums text-muted-foreground">{formatClock(elapsedMs)}</span>
        )}
      </div>

      {script && state && !saving && (
        <ol className="space-y-2">
          {script.steps.map((step, i) => {
            const current = i === state.index
            return (
              <li
                key={i}
                className={cn(
                  i < state.index && 'text-xs text-muted-foreground line-through',
                  current && 'text-base leading-snug font-medium',
                  i > state.index && 'text-xs text-muted-foreground',
                )}
              >
                {i + 1}. {step.instruction}
                {current && (
                  <div className="mt-1 text-xs font-normal text-muted-foreground">
                    {stepHint(script, state, enteredAt.length > 0)}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}

      <div className="flex gap-2">
        {script && (
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => void restart()}
            disabled={locked}
          >
            Restart
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="flex-1"
          onClick={() => void cancel()}
          disabled={locked}
        >
          Cancel
        </Button>
        <Button size="sm" className="flex-1" onClick={() => void done()} disabled={locked}>
          Done
        </Button>
      </div>
    </div>
  )
}
