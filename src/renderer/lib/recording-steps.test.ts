import { describe, expect, it } from 'vitest'
import type { RecordingScriptStep } from '@/shared/eval-review'
import { formatClock, stepProgress } from './recording-steps'

const steps = [10, 20].map(
  (seconds): RecordingScriptStep => ({ instruction: '', seconds, expect: { app: [] } }),
)

describe('stepProgress', () => {
  it('walks the steps by their durations', () => {
    expect(stepProgress(steps, 0)).toEqual({
      index: 0,
      fraction: 0,
      secondsLeft: 10,
      finished: false,
    })
    expect(stepProgress(steps, 15_000)).toEqual({
      index: 1,
      fraction: 0.25,
      secondsLeft: 15,
      finished: false,
    })
    expect(stepProgress(steps, 30_000)).toEqual({
      index: 2,
      fraction: 1,
      secondsLeft: 0,
      finished: true,
    })
  })
})

describe('formatClock', () => {
  it('renders m:ss', () => {
    expect(formatClock(65_400)).toBe('1:05')
  })
})
