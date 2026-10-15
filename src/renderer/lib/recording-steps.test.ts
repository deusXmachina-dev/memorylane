import { describe, expect, it } from 'vitest'
import type { RecordingScriptStep } from '@/shared/eval-review'
import { formatClock, stepState, stepTarget } from './recording-steps'

const typed: RecordingScriptStep = {
  instruction: '',
  seconds: 10,
  expect: { app: ['TextEdit'], summary: 'Typed.' },
}
const handsOff: RecordingScriptStep = {
  instruction: '',
  seconds: 20,
  expect: { app: ['browser'], tld: 'en.wikipedia.org' },
}

describe('stepState', () => {
  it('follows the entered steps and only counts down on hands-off steps', () => {
    expect(stepState([typed, handsOff], [], 0)).toEqual({
      index: 0,
      secondsLeft: null,
      finished: false,
    })
    expect(stepState([typed, handsOff], [1000], 50_000)).toEqual({
      index: 0,
      secondsLeft: null,
      finished: false,
    })
    expect(stepState([typed, handsOff], [1000, 5000], 10_000)).toEqual({
      index: 1,
      secondsLeft: 15,
      finished: false,
    })
    expect(stepState([typed, handsOff], [1000, 5000], 30_000)).toEqual({
      index: 1,
      secondsLeft: 0,
      finished: true,
    })
  })

  it('never finishes on a step that needs Done', () => {
    expect(stepState([handsOff, typed], [0, 1000], 99_000).finished).toBe(false)
  })
})

describe('stepTarget', () => {
  it('names the host for web steps and the apps otherwise', () => {
    expect(stepTarget(handsOff)).toBe('en.wikipedia.org')
    expect(stepTarget({ ...typed, expect: { app: ['TextEdit', 'Notepad'] } })).toBe(
      'TextEdit / Notepad',
    )
  })
})

describe('formatClock', () => {
  it('renders m:ss', () => {
    expect(formatClock(65_400)).toBe('1:05')
  })
})
