import { describe, expect, it } from 'vitest'
import { isPassiveView } from './passive-view'
import type { Activity } from './activity-types'

function makeActivity(interactions: Activity['interactions']): Activity {
  return {
    id: 'activity-1',
    startTimestamp: 1000,
    endTimestamp: 2000,
    context: {
      appName: 'Code',
      bundleId: 'com.microsoft.VSCode',
      windowTitle: 'Editor',
      tld: 'github.com',
    },
    interactions,
    frames: [],
    provenance: {
      eventWindowOffsets: [],
      frameOffsets: [],
      sourceWindowIds: [],
      sourceClosedBy: [],
    },
  }
}

describe('isPassiveView', () => {
  it.each([
    ['empty interactions', []],
    ['app_change only', [{ type: 'app_change' as const, timestamp: 1500 }]],
    [
      'app_change + presence heartbeats',
      [
        { type: 'app_change' as const, timestamp: 1100 },
        { type: 'presence' as const, timestamp: 1500 },
        { type: 'presence' as const, timestamp: 1900 },
      ],
    ],
  ])('is true for %s', (_name, interactions) => {
    expect(isPassiveView(makeActivity(interactions))).toBe(true)
  })

  it.each([
    ['click', [{ type: 'click' as const, timestamp: 1500 }]],
    ['keyboard', [{ type: 'keyboard' as const, timestamp: 1500, keyCount: 4 }]],
    [
      'scroll',
      [{ type: 'scroll' as const, timestamp: 1500, scrollDirection: 'vertical' as const }],
    ],
  ])('is false for %s', (_name, interactions) => {
    expect(isPassiveView(makeActivity(interactions))).toBe(false)
  })
})
