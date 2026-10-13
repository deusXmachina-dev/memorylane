import type { RecordingScriptStep } from '@/shared/eval-review'

export interface StepProgress {
  /** Step the operator should be on; `steps.length` once every step's time is up. */
  index: number
  /** How far through the current step's time, 0..1. */
  fraction: number
  secondsLeft: number
  finished: boolean
}

/** Paces a script by each step's rough duration. */
export function stepProgress(steps: RecordingScriptStep[], elapsedMs: number): StepProgress {
  const elapsed = elapsedMs / 1000
  let start = 0
  for (let i = 0; i < steps.length; i++) {
    const end = start + steps[i].seconds
    if (elapsed < end) {
      return {
        index: i,
        fraction: (elapsed - start) / steps[i].seconds,
        secondsLeft: Math.ceil(end - elapsed),
        finished: false,
      }
    }
    start = end
  }
  return { index: steps.length, fraction: 1, secondsLeft: 0, finished: true }
}

/** m:ss */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
