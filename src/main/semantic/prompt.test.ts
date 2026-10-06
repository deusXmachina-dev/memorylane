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

function timelineOf(prompt: string): string[] {
  const section = prompt.split('## Activity timeline\n')[1].split('\n\n')[0]
  return section.split('\n')
}

describe('describeInteraction', () => {
  it('narrates the key sequence in order', () => {
    expect(
      describeInteraction({
        type: 'keyboard',
        timestamp: 0,
        keyCount: 60,
        keySequence: [
          { key: 'char', count: 42 },
          { key: 'enter', count: 1 },
          { key: 'char', count: 10 },
          { key: 'delete', count: 3 },
          { key: 'mod+s', count: 1 },
        ],
      }),
    ).toBe(
      'typed 42 characters, then pressed Enter, then typed 10 characters, then deleted 3 characters, then pressed Cmd/Ctrl+S (save)',
    )
  })

  it('falls back to the key count for events without a sequence', () => {
    expect(describeInteraction({ type: 'keyboard', timestamp: 0, keyCount: 7 })).toBe(
      'typed 7 keys',
    )
  })
})

describe('interaction timeline', () => {
  it('states when nothing was typed', () => {
    const prompt = buildSemanticPrompt(
      makeActivity([
        { type: 'scroll', timestamp: 2000, durationMs: 3000 },
        { type: 'scroll', timestamp: 6000, durationMs: 4000 },
        { type: 'click', timestamp: 9000, clickCount: 2 },
      ]),
      'video',
    )

    expect(timelineOf(prompt)).toEqual([
      '- Input totals: 0 characters typed, 2 scroll bursts, 2 clicks',
      '- t+1.0s: scrolled for 7s',
      '- t+8.0s: 2 clicks',
    ])
  })

  it('joins adjacent typing events into one sequence', () => {
    const prompt = buildSemanticPrompt(
      makeActivity([
        { type: 'keyboard', timestamp: 2000, keySequence: [{ key: 'char', count: 20 }] },
        {
          type: 'keyboard',
          timestamp: 6000,
          keySequence: [
            { key: 'char', count: 5 },
            { key: 'enter', count: 1 },
          ],
        },
      ]),
      'video',
    )

    expect(timelineOf(prompt)[1]).toBe('- t+1.0s: typed 25 characters, then pressed Enter')
  })

  it('keeps a submit at the end of a long activity', () => {
    const interactions: Activity['interactions'] = []
    for (let i = 0; i < 40; i++) {
      interactions.push({ type: i % 2 ? 'scroll' : 'click', timestamp: 2000 + i * 1000 })
    }
    interactions.push({
      type: 'keyboard',
      timestamp: 50_000,
      keySequence: [{ key: 'mod+enter', count: 1 }],
    })
    interactions.push({ type: 'click', timestamp: 51_000 })
    for (let i = 0; i < 20; i++) {
      interactions.push({ type: i % 2 ? 'click' : 'scroll', timestamp: 52_000 + i * 1000 })
    }

    const timeline = timelineOf(buildSemanticPrompt(makeActivity(interactions), 'video'))

    expect(timeline).toContain('- t+49.0s: pressed Cmd/Ctrl+Enter (send/submit)')
    expect(timeline.length).toBeLessThanOrEqual(1 + 20 + 3)
    expect(timeline.some((line) => line.includes('events omitted'))).toBe(true)
  })
})
