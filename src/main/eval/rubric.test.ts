import { describe, it, expect } from 'vitest'
import { computeAggregate, RUBRIC_DIMENSIONS } from './rubric'

function scores(value: number, overrides: Record<string, number> = {}): Map<string, number> {
  const m = new Map<string, number>()
  for (const d of RUBRIC_DIMENSIONS) m.set(d.key, value)
  for (const [k, v] of Object.entries(overrides)) m.set(k, v)
  return m
}

describe('rubric dimension weights', () => {
  it('sum to 1.0', () => {
    const total = RUBRIC_DIMENSIONS.reduce((a, d) => a + d.weight, 0)
    expect(total).toBeCloseTo(1, 6)
  })
})

describe('computeAggregate', () => {
  it('maps all-5s to 10/10 with no cap', () => {
    const { aggregate10, capped } = computeAggregate(scores(5))
    expect(aggregate10).toBe(10)
    expect(capped).toBe(false)
  })

  it('maps all-4s to 8/10 with no cap', () => {
    const { aggregate10, capped } = computeAggregate(scores(4))
    expect(aggregate10).toBe(8)
    expect(capped).toBe(false)
  })

  it('hard-caps at 4.0 when hallucination <= 2', () => {
    const { aggregate10, capped } = computeAggregate(scores(5, { hallucination: 1 }))
    expect(aggregate10).toBe(4)
    expect(capped).toBe(true)
  })

  it('hard-caps at 4.0 when noRawInteractions <= 2', () => {
    const { aggregate10, capped } = computeAggregate(scores(5, { noRawInteractions: 2 }))
    expect(aggregate10).toBe(4)
    expect(capped).toBe(true)
  })

  it('does not cap when an already-low aggregate is below the cap', () => {
    // All 2s -> 4.0 exactly; hallucination=2 triggers the cap predicate but
    // the value is not above 4.0, so it stays 4.0 and is not marked capped.
    const { aggregate10, capped } = computeAggregate(scores(2))
    expect(aggregate10).toBe(4)
    expect(capped).toBe(false)
  })

  it('does not cap a healthy summary', () => {
    const { capped } = computeAggregate(scores(5, { hallucination: 3, noRawInteractions: 3 }))
    expect(capped).toBe(false)
  })
})
