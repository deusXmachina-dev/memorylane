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
  it('appends only submit-class key runs to a typing session', () => {
    expect(
      describeInteraction({
        type: 'keyboard',
        timestamp: 0,
        keyCount: 42,
        keySequence: [
          { kind: 'type', count: 30 },
          { kind: 'delete', count: 3 },
          { kind: 'paste', count: 1 },
          { kind: 'type', count: 6 },
          { kind: 'enter', count: 2 },
        ],
      }),
    ).toBe('typing session (42 keys): pasted, pressed Enter ×2')
  })

  it('keeps the plain typing line when no submit key was pressed', () => {
    expect(
      describeInteraction({
        type: 'keyboard',
        timestamp: 0,
        keyCount: 5,
        keySequence: [{ kind: 'type', count: 5 }],
      }),
    ).toBe('typing session (5 keys)')
  })
})
