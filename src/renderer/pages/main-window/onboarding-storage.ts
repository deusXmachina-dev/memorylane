// Storage + migration helpers for the renderer-driven onboarding flow.
//
// The current step is persisted as a single integer ("lastCompletedStepIndex").
// When the step list shape changes, bump ONBOARDING_LAYOUT_VERSION and add a
// shift in `migrateLayoutVersion` so already-onboarded users aren't bounced
// back into the new step.

export const LAST_COMPLETED_STEP_INDEX_KEY = 'memorylane:onboarding:lastCompletedStepIndex'
export const ONBOARDING_LAYOUT_VERSION_KEY = 'memorylane:onboarding:layoutVersion'
export const ONBOARDING_LAYOUT_VERSION = 2

// Legacy keys, read once on startup to migrate users who already completed
// onboarding under the old three-flag model. Removed after migration so the
// new index becomes the sole source of truth.
export const LEGACY_WELCOME_SEEN_KEY = 'memorylane:onboarding:welcomeSeen'
export const LEGACY_CONNECT_STEP_DONE_KEY = 'memorylane:onboarding:connectStepDone'
export const LEGACY_CAPTURE_STEP_DONE_KEY = 'memorylane:onboarding:captureStepDone'

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

function readLegacyBool(storage: OnboardingStorage, key: string): boolean {
  return safe(() => storage.getItem(key) === '1', false)
}

function removeKey(storage: OnboardingStorage, key: string): void {
  safe(() => storage.removeItem(key), undefined)
}

/**
 * Read the persisted last-completed step index, migrating from the old
 * three-flag scheme (welcomeSeen / connectStepDone / captureStepDone) if any
 * of those keys are present. Indexes refer to the consumer step list — the
 * highest possible legacy completion is `capture`, so the migrated value is
 * the consumer "capture" index. On enterprise (5 steps vs. 6) the migrated
 * value can overshoot the step array; that's intentional — `findIndex` returns
 * -1 in that case and `computedStep` resolves to `dashboard`, so the legacy
 * enterprise user lands directly on the dashboard instead of being re-walked
 * through the new Privacy step.
 */
export function readOrMigrateLastCompletedIndex(storage: OnboardingStorage): number {
  const stored = readIntFlag(storage, LAST_COMPLETED_STEP_INDEX_KEY, -1)
  const layoutVersion = readIntFlag(storage, ONBOARDING_LAYOUT_VERSION_KEY, 1)

  let current = stored
  if (current < 0) {
    const hadWelcome = readLegacyBool(storage, LEGACY_WELCOME_SEEN_KEY)
    const hadConnect = readLegacyBool(storage, LEGACY_CONNECT_STEP_DONE_KEY)
    const hadCapture = readLegacyBool(storage, LEGACY_CAPTURE_STEP_DONE_KEY)

    if (hadWelcome || hadConnect || hadCapture) {
      // Legacy consumer indices (pre-blacklist):
      //   welcome=0, permissions=1, plan=2, connect=3, capture=4.
      let migrated = -1
      if (hadWelcome) migrated = Math.max(migrated, 0)
      if (hadConnect) migrated = Math.max(migrated, 3)
      if (hadCapture) migrated = Math.max(migrated, 4)
      current = migrated
      removeKey(storage, LEGACY_WELCOME_SEEN_KEY)
      removeKey(storage, LEGACY_CONNECT_STEP_DONE_KEY)
      removeKey(storage, LEGACY_CAPTURE_STEP_DONE_KEY)
    }
  }

  // v1 → v2: blacklist step was inserted just before capture. Anything that
  // used to land on capture (consumer 4, enterprise 3) shifts by one so we
  // don't drop already-onboarded users back into the new step.
  if (layoutVersion < 2 && current >= 0) {
    if (current >= 3) current += 1
  }

  if (current !== stored) writeIntFlag(storage, LAST_COMPLETED_STEP_INDEX_KEY, current)
  if (layoutVersion !== ONBOARDING_LAYOUT_VERSION) {
    writeIntFlag(storage, ONBOARDING_LAYOUT_VERSION_KEY, ONBOARDING_LAYOUT_VERSION)
  }
  return current
}
