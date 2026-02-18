import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ActivityManager } from './activity-manager'
import { Activity, ActivityScreenshot, InteractionContext } from '../../shared/types'

vi.mock('../logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@constants', () => ({
  ACTIVITY_CONFIG: {
    MIN_ACTIVITY_DURATION_MS: 100,
    MAX_ACTIVITY_DURATION_MS: 300_000,
    FORCE_SPLIT_CHECK_INTERVAL_MS: 60_000,
    MAX_SCREENSHOTS_PER_ACTIVITY: 20,
    MAX_SCREENSHOTS_FOR_LLM: 6,
  },
  BROWSER_BUNDLE_IDS: new Set(['com.apple.Safari', 'com.google.Chrome']),
  TRANSIENT_APP_BUNDLE_IDS: new Set(['com.apple.Spotlight']),
}))

function makeScreenshot(
  trigger: ActivityScreenshot['trigger'] = 'activity_start',
): ActivityScreenshot {
  return {
    id: `ss-${Date.now()}-${Math.random()}`,
    filepath: `/tmp/test-${Date.now()}.png`,
    timestamp: Date.now(),
    trigger,
    display: { id: 1, width: 1920, height: 1080 },
  }
}

function makeAppChangeEvent(
  appName: string,
  bundleId: string,
  previousAppName?: string,
): InteractionContext {
  return {
    type: 'app_change',
    timestamp: Date.now(),
    displayId: 1,
    activeWindow: {
      title: `${appName} Window`,
      processName: appName,
      bundleId,
    },
    previousWindow: previousAppName
      ? { title: `${previousAppName} Window`, processName: previousAppName }
      : undefined,
  }
}

describe('ActivityManager', () => {
  let captureProvider: {
    captureImmediate: ReturnType<typeof vi.fn>
    captureIfVisualChange: ReturnType<typeof vi.fn>
    captureWindowByTitle: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    captureProvider = {
      captureImmediate: vi.fn().mockResolvedValue(makeScreenshot()),
      captureIfVisualChange: vi.fn().mockResolvedValue(null),
      captureWindowByTitle: vi.fn().mockResolvedValue(makeScreenshot('activity_end')),
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('activity completion', () => {
    it('should complete activity with screenshots', async () => {
      const manager = new ActivityManager(captureProvider)

      const completedActivities: Activity[] = []
      manager.onActivityComplete((activity) => {
        completedActivities.push(activity)
      })

      await manager.handleInteraction(makeAppChangeEvent('Code', 'com.microsoft.VSCode'))
      await vi.advanceTimersByTimeAsync(200)
      await manager.handleInteraction(makeAppChangeEvent('Terminal', 'com.apple.Terminal', 'Code'))

      expect(completedActivities).toHaveLength(1)
      expect(completedActivities[0].appName).toBe('Code')
      expect(completedActivities[0].screenshots.length).toBeGreaterThan(0)
    })
  })

  describe('activity lifecycle basics', () => {
    it('should discard activities shorter than minimum duration', async () => {
      const manager = new ActivityManager(captureProvider)

      const completedActivities: Activity[] = []
      manager.onActivityComplete((activity) => {
        completedActivities.push(activity)
      })

      // Switch apps immediately (no time advance → too short)
      await manager.handleInteraction(makeAppChangeEvent('Code', 'com.microsoft.VSCode'))
      await manager.handleInteraction(makeAppChangeEvent('Terminal', 'com.apple.Terminal', 'Code'))

      expect(completedActivities).toHaveLength(0)
    })

    it('should skip transient apps', async () => {
      const manager = new ActivityManager(captureProvider)

      await manager.handleInteraction(makeAppChangeEvent('Code', 'com.microsoft.VSCode'))

      const before = manager.getCurrentActivity()
      expect(before?.appName).toBe('Code')

      // Spotlight pops up — should not change activity
      await manager.handleInteraction(
        makeAppChangeEvent('Spotlight', 'com.apple.Spotlight', 'Code'),
      )

      const after = manager.getCurrentActivity()
      expect(after?.appName).toBe('Code')
    })
  })
})
