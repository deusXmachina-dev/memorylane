import { describe, it, expect } from 'vitest'
import { dot, meanPool, normalize } from './vector-math'

describe('dot', () => {
  it('computes the dot product', () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32)
  })

  it('equals cosine similarity on unit vectors', () => {
    expect(dot([1, 0], [0, 1])).toBe(0)
    expect(dot([1, 0], [1, 0])).toBe(1)
    const halfway = normalize([1, 1])!
    expect(dot([1, 0], halfway)).toBeCloseTo(Math.SQRT1_2)
  })
})

describe('meanPool', () => {
  it('averages element-wise', () => {
    expect(
      meanPool([
        [1, 0, 3],
        [3, 2, 1],
      ]),
    ).toEqual([2, 1, 2])
  })

  it('returns the single vector unchanged', () => {
    expect(meanPool([[0.5, 0.5]])).toEqual([0.5, 0.5])
  })

  it('returns null for empty input', () => {
    expect(meanPool([])).toBeNull()
  })
})

describe('normalize', () => {
  it('produces a unit vector', () => {
    const n = normalize([3, 4])!
    expect(n).toEqual([0.6, 0.8])
    expect(dot(n, n)).toBeCloseTo(1)
  })

  it('returns null for the zero vector', () => {
    expect(normalize([0, 0, 0])).toBeNull()
    expect(normalize([])).toBeNull()
  })
})
