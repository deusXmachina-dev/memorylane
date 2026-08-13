import { describe, expect, it } from 'vitest'
import { buildSemanticPrompt } from './prompt'
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
      makeActivity([{ type: 'presence', timestamp: 1500 }]),
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
