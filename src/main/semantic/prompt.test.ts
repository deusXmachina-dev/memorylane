import { describe, expect, it } from 'vitest'
import { buildSemanticPrompt, describeInteraction } from './prompt'
import type { Activity } from '@main/activity/activity-types'

const PASSIVE_RULE = 'The user did not click, type, or scroll in this window'

function makeActivity(interactions: Activity['interactions']): Activity {
  return {
    id: 'activity-1',
    startTimestamp: 1000,
    endTimestamp: 121_000,
    context: {
      appName: 'Google Chrome',
      bundleId: 'com.google.Chrome',
      windowTitle: 'Models | OpenRouter',
      tld: 'openrouter.ai',
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

describe('buildSemanticPrompt', () => {
  it('warns the model off implied actions when nothing was clicked, typed or scrolled', () => {
    const prompt = buildSemanticPrompt(
      makeActivity([{ type: 'app_change', timestamp: 1500 }]),
      'video',
    )

    expect(prompt).toContain(PASSIVE_RULE)
    expect(prompt).toContain('NEVER imply edits, authorship, or actions taken.')
  })

  it('omits the rule once the window has real engagement', () => {
    const prompt = buildSemanticPrompt(makeActivity([{ type: 'click', timestamp: 1500 }]), 'video')

    expect(prompt).not.toContain(PASSIVE_RULE)
  })
})

describe('describeInteraction', () => {
  it('renders key classes instead of key counts', () => {
    expect(
      describeInteraction({
        type: 'keyboard',
        timestamp: 1,
        keyCount: 42,
        keySequence: [
          { kind: 'paste', count: 1 },
          { kind: 'type', count: 30 },
          { kind: 'enter', count: 2 },
          { kind: 'save', count: 1 },
        ],
      }),
    ).toBe('pasted, typed text, pressed Enter ×2, saved')
    expect(describeInteraction({ type: 'keyboard', timestamp: 1, keyCount: 7 })).toBe('typed text')
  })

  it('renders click classes', () => {
    expect(
      describeInteraction({
        type: 'click',
        timestamp: 1,
        clickSequence: [
          { kind: 'left', count: 3 },
          { kind: 'double', count: 1 },
        ],
      }),
    ).toBe('3× click, double-click')
    expect(describeInteraction({ type: 'click', timestamp: 1 })).toBe('click')
  })

  it('appends the page URL without query or hash to an app switch', () => {
    expect(
      describeInteraction({
        type: 'app_change',
        timestamp: 1,
        activeWindow: {
          title: 'Mercury',
          processName: 'Google Chrome',
          url: 'https://app.mercury.com/payments/new?token=abc#step',
        },
      }),
    ).toBe('app switched to Google Chrome (Mercury) at https://app.mercury.com/payments/new')
  })
})

describe('context URL', () => {
  it('lists the page URL under the TLD', () => {
    const activity = makeActivity([{ type: 'click', timestamp: 1500 }])
    activity.context.url = 'https://openrouter.ai/models?q=gemini'
    const prompt = buildSemanticPrompt(activity, 'video')
    expect(prompt).toContain('- TLD: openrouter.ai\n- URL: https://openrouter.ai/models\n')
  })

  it('omits non-http URLs', () => {
    const activity = makeActivity([{ type: 'click', timestamp: 1500 }])
    activity.context.url = 'chrome://newtab'
    expect(buildSemanticPrompt(activity, 'video')).not.toContain('- URL:')
  })
})
