import { describe, it, expect } from 'vitest'
import {
  parseGoldenMd,
  renderGoldenMd,
  matchSegments,
  formatOffset,
  type GoldenActivity,
} from './golden-md'
import type { ReplayActivity } from './types'

function replayActivity(over: Partial<ReplayActivity> = {}): ReplayActivity {
  return {
    activityId: 'a1',
    startTimestamp: 1_000_000,
    endTimestamp: 1_090_000,
    durationMs: 90_000,
    appName: 'Code',
    windowTitle: 'auth.ts',
    tld: undefined,
    interactionCount: 5,
    summary: 'Stepped through the auth middleware in the debugger.',
    summaryModel: 'google/gemini-2.5-flash',
    ocrText: '',
    frameRefs: [],
    selectedSnapshotPaths: [],
    diagnostics: null,
    ...over,
  }
}

describe('formatOffset', () => {
  it('renders mm:ss from ms', () => {
    expect(formatOffset(0)).toBe('0:00')
    expect(formatOffset(90_000)).toBe('1:30')
    expect(formatOffset(605_000)).toBe('10:05')
  })
})

describe('renderGoldenMd → parseGoldenMd round-trip', () => {
  it('preserves app, title, offsets, and summary', () => {
    const acts = [
      replayActivity({ activityId: 'a1', startTimestamp: 1_000_000, endTimestamp: 1_090_000 }),
      replayActivity({
        activityId: 'a2',
        appName: 'Chrome',
        windowTitle: 'github.com',
        startTimestamp: 1_090_000,
        endTimestamp: 1_130_000,
        summary: "Reviewed the PR's diff.",
      }),
    ]
    const md = renderGoldenMd('vscode-debug', acts)
    const parsed = parseGoldenMd(md)

    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({
      appName: 'Code',
      windowTitle: 'auth.ts',
      startOffsetMs: 0,
      endOffsetMs: 90_000,
      summary: 'Stepped through the auth middleware in the debugger.',
    })
    expect(parsed[1]).toMatchObject({
      appName: 'Chrome',
      windowTitle: 'github.com',
      startOffsetMs: 90_000,
      endOffsetMs: 130_000,
      summary: "Reviewed the PR's diff.",
    })
  })

  it('ignores HTML comments and tolerates -> arrows + multi-line summaries', () => {
    const md = [
      '# Golden — x',
      '<!-- editing instructions -->',
      '## 1. Code',
      '0:00 -> 0:30',
      'Line one.',
      'Line two.',
      '',
      '---',
      '## 2. Slack — general',
      '0:30 → 1:00',
      'Caught up on messages.',
    ].join('\n')
    const parsed = parseGoldenMd(md)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({
      appName: 'Code',
      windowTitle: undefined,
      endOffsetMs: 30_000,
    })
    expect(parsed[0].summary).toBe('Line one.\nLine two.')
    expect(parsed[1]).toMatchObject({ appName: 'Slack', windowTitle: 'general' })
  })
})

describe('matchSegments', () => {
  const goldens: GoldenActivity[] = [
    {
      index: 1,
      appName: 'Code',
      windowTitle: 'auth.ts',
      startOffsetMs: 0,
      endOffsetMs: 90_000,
      summary: '',
    },
    { index: 2, appName: 'Chrome', startOffsetMs: 90_000, endOffsetMs: 130_000, summary: '' },
  ]

  it('matches well-aligned activities and reports full coverage', () => {
    const report = matchSegments({
      activities: [
        { activityId: 'a1', startOffsetMs: 0, endOffsetMs: 88_000, windowTitle: 'auth.ts' },
        { activityId: 'a2', startOffsetMs: 90_000, endOffsetMs: 130_000 },
      ],
      goldens,
    })
    expect(report.coverage).toBe(1)
    expect(report.unmatchedGoldenIndexes).toEqual([])
    expect(report.matches.map((m) => m.goldenIndex)).toEqual([1, 2])
  })

  it('flags an over-split (extra activity) and a missed golden', () => {
    // One golden (#1) is produced; #2 has no overlapping activity; one extra splinter.
    const report = matchSegments({
      activities: [
        { activityId: 'a1', startOffsetMs: 0, endOffsetMs: 90_000 },
        { activityId: 'splinter', startOffsetMs: 200_000, endOffsetMs: 260_000 },
      ],
      goldens,
    })
    expect(report.unmatchedGoldenIndexes).toEqual([2])
    expect(report.unmatchedActivityIds).toEqual(['splinter'])
    expect(report.coverage).toBe(0.5)
  })
})
