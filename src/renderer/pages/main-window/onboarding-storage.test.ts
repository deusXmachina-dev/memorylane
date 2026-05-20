import { describe, expect, it } from 'vitest'
import {
  LAST_COMPLETED_STEP_INDEX_KEY,
  readLastCompletedIndex,
  writeIntFlag,
  type OnboardingStorage,
} from './onboarding-storage'

function makeStorage(seed: Record<string, string> = {}): OnboardingStorage & {
  data: Map<string, string>
} {
  const data = new Map<string, string>(Object.entries(seed))
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  }
}

describe('readLastCompletedIndex', () => {
  it('returns -1 for a fresh install with no key set', () => {
    expect(readLastCompletedIndex(makeStorage())).toBe(-1)
  })

  it('returns the stored integer when present', () => {
    expect(readLastCompletedIndex(makeStorage({ [LAST_COMPLETED_STEP_INDEX_KEY]: '3' }))).toBe(3)
  })

  it('falls back to -1 on a non-numeric stored value', () => {
    expect(
      readLastCompletedIndex(makeStorage({ [LAST_COMPLETED_STEP_INDEX_KEY]: 'not-a-number' })),
    ).toBe(-1)
  })

  it('tolerates a storage that throws (e.g. disabled localStorage)', () => {
    const throwing: OnboardingStorage = {
      getItem: () => {
        throw new Error('disabled')
      },
      setItem: () => {
        throw new Error('disabled')
      },
      removeItem: () => {
        throw new Error('disabled')
      },
    }

    expect(() => readLastCompletedIndex(throwing)).not.toThrow()
    expect(readLastCompletedIndex(throwing)).toBe(-1)
  })
})

describe('writeIntFlag', () => {
  it('writes the integer as a string', () => {
    const storage = makeStorage()
    writeIntFlag(storage, LAST_COMPLETED_STEP_INDEX_KEY, 5)
    expect(storage.data.get(LAST_COMPLETED_STEP_INDEX_KEY)).toBe('5')
  })

  it('swallows errors from throwing storage', () => {
    const throwing: OnboardingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('disabled')
      },
      removeItem: () => {},
    }
    expect(() => writeIntFlag(throwing, LAST_COMPLETED_STEP_INDEX_KEY, 1)).not.toThrow()
  })
})
