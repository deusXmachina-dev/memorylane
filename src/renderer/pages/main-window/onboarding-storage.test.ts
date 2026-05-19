import { beforeEach, describe, expect, it } from 'vitest'
import {
  LAST_COMPLETED_STEP_INDEX_KEY,
  LEGACY_CAPTURE_STEP_DONE_KEY,
  LEGACY_CONNECT_STEP_DONE_KEY,
  LEGACY_WELCOME_SEEN_KEY,
  ONBOARDING_LAYOUT_VERSION,
  ONBOARDING_LAYOUT_VERSION_KEY,
  readOrMigrateLastCompletedIndex,
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

describe('readOrMigrateLastCompletedIndex', () => {
  let storage: ReturnType<typeof makeStorage>

  beforeEach(() => {
    storage = makeStorage()
  })

  it('returns -1 for a fresh install with no keys', () => {
    expect(readOrMigrateLastCompletedIndex(storage)).toBe(-1)
    expect(storage.data.get(ONBOARDING_LAYOUT_VERSION_KEY)).toBe(String(ONBOARDING_LAYOUT_VERSION))
  })

  it('migrates legacy "captureStepDone" → consumer capture index, then v1→v2 shift', () => {
    storage = makeStorage({ [LEGACY_CAPTURE_STEP_DONE_KEY]: '1' })

    // Legacy capture index is 4; v1→v2 shifts >=3 by +1, so 4 → 5.
    expect(readOrMigrateLastCompletedIndex(storage)).toBe(5)
    expect(storage.data.get(LAST_COMPLETED_STEP_INDEX_KEY)).toBe('5')
    expect(storage.data.has(LEGACY_CAPTURE_STEP_DONE_KEY)).toBe(false)
    expect(storage.data.get(ONBOARDING_LAYOUT_VERSION_KEY)).toBe(String(ONBOARDING_LAYOUT_VERSION))
  })

  it('migrates legacy "welcomeSeen" only → 0 (no v1→v2 shift, below threshold)', () => {
    storage = makeStorage({ [LEGACY_WELCOME_SEEN_KEY]: '1' })

    expect(readOrMigrateLastCompletedIndex(storage)).toBe(0)
    expect(storage.data.has(LEGACY_WELCOME_SEEN_KEY)).toBe(false)
  })

  it('migrates legacy "connectStepDone" → 3 shifted to 4', () => {
    storage = makeStorage({ [LEGACY_CONNECT_STEP_DONE_KEY]: '1' })

    // Legacy connect=3; v1→v2 shifts >=3 by +1 → 4.
    expect(readOrMigrateLastCompletedIndex(storage)).toBe(4)
    expect(storage.data.has(LEGACY_CONNECT_STEP_DONE_KEY)).toBe(false)
  })

  it('takes the max when multiple legacy flags are present', () => {
    storage = makeStorage({
      [LEGACY_WELCOME_SEEN_KEY]: '1',
      [LEGACY_CONNECT_STEP_DONE_KEY]: '1',
      [LEGACY_CAPTURE_STEP_DONE_KEY]: '1',
    })

    // max(0, 3, 4) = 4, then v1→v2 shift → 5.
    expect(readOrMigrateLastCompletedIndex(storage)).toBe(5)
  })

  it('applies v1→v2 shift to a stored v1 index of 4 (capture)', () => {
    storage = makeStorage({ [LAST_COMPLETED_STEP_INDEX_KEY]: '4' })

    expect(readOrMigrateLastCompletedIndex(storage)).toBe(5)
    expect(storage.data.get(LAST_COMPLETED_STEP_INDEX_KEY)).toBe('5')
    expect(storage.data.get(ONBOARDING_LAYOUT_VERSION_KEY)).toBe(String(ONBOARDING_LAYOUT_VERSION))
  })

  it('applies v1→v2 shift to a stored v1 index of 3 (connect)', () => {
    storage = makeStorage({ [LAST_COMPLETED_STEP_INDEX_KEY]: '3' })

    expect(readOrMigrateLastCompletedIndex(storage)).toBe(4)
  })

  it('does NOT shift v1 indexes below 3', () => {
    storage = makeStorage({ [LAST_COMPLETED_STEP_INDEX_KEY]: '2' })

    expect(readOrMigrateLastCompletedIndex(storage)).toBe(2)
    expect(storage.data.get(LAST_COMPLETED_STEP_INDEX_KEY)).toBe('2')
  })

  it('leaves v2 indexes untouched on subsequent reads', () => {
    storage = makeStorage({
      [LAST_COMPLETED_STEP_INDEX_KEY]: '4',
      [ONBOARDING_LAYOUT_VERSION_KEY]: '2',
    })

    expect(readOrMigrateLastCompletedIndex(storage)).toBe(4)
    expect(storage.data.get(LAST_COMPLETED_STEP_INDEX_KEY)).toBe('4')
  })

  it('treats a non-numeric stored value as missing and falls back to legacy migration', () => {
    storage = makeStorage({
      [LAST_COMPLETED_STEP_INDEX_KEY]: 'not-a-number',
      [LEGACY_WELCOME_SEEN_KEY]: '1',
    })

    // Non-numeric → readIntFlag falls back to -1, which triggers legacy migration.
    expect(readOrMigrateLastCompletedIndex(storage)).toBe(0)
  })

  it('writes the layout-version key even when nothing else changes', () => {
    storage = makeStorage({ [LAST_COMPLETED_STEP_INDEX_KEY]: '0' })

    readOrMigrateLastCompletedIndex(storage)
    expect(storage.data.get(ONBOARDING_LAYOUT_VERSION_KEY)).toBe(String(ONBOARDING_LAYOUT_VERSION))
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

    expect(() => readOrMigrateLastCompletedIndex(throwing)).not.toThrow()
    expect(readOrMigrateLastCompletedIndex(throwing)).toBe(-1)
  })
})
