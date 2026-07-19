import { describe, expect, it } from 'vitest'
import { formatMonthlyHours } from './format'

describe('formatMonthlyHours', () => {
  it('returns empty when frequency or time is missing', () => {
    expect(formatMonthlyHours(0, 2)).toBe('')
    expect(formatMonthlyHours(10, 0)).toBe('')
  })

  it('rounds to the nearest quarter-hour', () => {
    // 26 min/run × 1×/wk ≈ 113 min/mo
    expect(formatMonthlyHours(26, 1)).toBe('2h')
    // 20 min/run × 0.5×/wk ≈ 43.5 min/mo
    expect(formatMonthlyHours(20, 0.5)).toBe('0.75h')
    // 7 min/run × 1×/wk ≈ 30.4 min/mo
    expect(formatMonthlyHours(7, 1)).toBe('0.5h')
  })

  it('floors tiny real values at 0.25h instead of reading as 0', () => {
    expect(formatMonthlyHours(1, 0.25)).toBe('0.25h')
  })
})
