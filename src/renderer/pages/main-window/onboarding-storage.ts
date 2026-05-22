// Storage helpers for the renderer-driven onboarding flow.
// Returning users are detected via DB activity count (`hasExistingActivities`),
// not via localStorage.

export const LAST_COMPLETED_STEP_INDEX_KEY = 'memorylane:onboarding:lastCompletedStepIndex'

export interface OnboardingStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const localStorageAdapter: OnboardingStorage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

export function readIntFlag(storage: OnboardingStorage, key: string, fallback: number): number {
  return safe(() => {
    const raw = storage.getItem(key)
    if (raw === null) return fallback
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) ? parsed : fallback
  }, fallback)
}

export function writeIntFlag(storage: OnboardingStorage, key: string, value: number): void {
  safe(() => storage.setItem(key, String(value)), undefined)
}

export function readLastCompletedIndex(storage: OnboardingStorage): number {
  return readIntFlag(storage, LAST_COMPLETED_STEP_INDEX_KEY, -1)
}
