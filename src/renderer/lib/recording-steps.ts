import { isHandsOffStep, type RecordingScriptStep } from '@/shared/eval-review'

export interface StepState {
  index: number
  /** Seconds left on an entered hands-off step, else null. */
  secondsLeft: number | null
  finished: boolean
}

export function stepState(
  steps: RecordingScriptStep[],
  enteredAt: number[],
  now: number,
): StepState {
  const index = Math.max(0, enteredAt.length - 1)
  const step = steps[index]
  const entered = enteredAt[index]
  if (!step || entered === undefined || !isHandsOffStep(step)) {
    return { index, secondsLeft: null, finished: false }
  }
  const secondsLeft = Math.max(0, Math.ceil((entered + step.seconds * 1000 - now) / 1000))
  return { index, secondsLeft, finished: index === steps.length - 1 && secondsLeft === 0 }
}

export function stepTarget(step: RecordingScriptStep): string {
  return step.expect.tld ?? step.expect.app.join(' / ')
}

/** m:ss */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
