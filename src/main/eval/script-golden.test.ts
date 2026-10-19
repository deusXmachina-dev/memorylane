import { describe, expect, it } from 'vitest'
import type { RecordingScript } from '@/shared/eval-review'
import { goldenFromScript } from './script-golden'
import { mustMentionRecall } from './deterministic'
import type { ReplayActivity } from './types'

function block(
  startSec: number,
  appName: string,
  extra: Partial<ReplayActivity> = {},
): ReplayActivity {
  return {
    activityId: `a${startSec}`,
    startTimestamp: startSec * 1000,
    endTimestamp: startSec * 1000 + 5000,
    durationMs: 5000,
    appName,
    windowTitle: '',
    tld: undefined,
    interactionCount: 0,
    summary: 'live summary',
    summaryModel: 'video',
    ocrText: '',
    frameRefs: [],
    selectedSnapshotPaths: [],
    diagnostics: null,
    ...extra,
  }
}

const script: RecordingScript = {
  id: 'demo',
  title: 'Demo',
  targets: [],
  setup: [],
  steps: [
    {
      instruction: '',
      seconds: 5,
      expect: { app: ['TextEdit'], summary: 'Wrote a note.', mustMention: ['note'] },
    },
    { instruction: '', seconds: 1, expect: { app: ['browser'], dropped: true } },
    { instruction: '', seconds: 20, expect: { app: ['browser'], tld: 'en.wikipedia.org' } },
  ],
}

const followed = (): ReplayActivity[] => [
  block(20, 'Google Chrome', {
    tld: 'en.wikipedia.org',
    summary: 'Viewed Pallet',
    summaryModel: 'heuristic:viewed',
  }),
  block(0, 'TextEdit'),
  block(10, 'Google Chrome', { dropped: { reason: 'too_short', detail: '900ms < 3000ms' } }),
]

describe('goldenFromScript', () => {
  it('fills summaries from the script when the recording follows it', () => {
    const { check, golden } = goldenFromScript(script, followed())
    expect(check).toEqual({
      scriptId: 'demo',
      followed: true,
      expected: 3,
      produced: 3,
      issues: [],
      steps: [
        { ok: true, got: 'TextEdit', issue: null },
        { ok: true, got: 'Google Chrome', issue: null },
        { ok: true, got: 'Google Chrome · en.wikipedia.org', issue: null },
      ],
    })
    expect(golden?.map((g) => g.summary)).toEqual([
      'Wrote a note.',
      'live summary',
      'Viewed Pallet',
    ])
    expect(golden?.[0].mustMention).toEqual(['note'])
    expect(golden?.[1].dropped).toBeDefined()
  })

  it('reports a count mismatch and produces no golden', () => {
    const blocks = [...followed(), block(30, 'Google Chrome', { tld: 'github.com' })]
    const { check, golden } = goldenFromScript(script, blocks)
    expect(check.followed).toBe(false)
    expect(check.issues).toContain('expected 3 activities, got 4')
    expect(golden).toBeNull()
  })

  it('flags wrong app, missing drop and input on a hands-off view', () => {
    const blocks = [
      block(0, 'Notes'),
      block(10, 'Google Chrome', { tld: 'en.wikipedia.org' }),
      block(20, 'Google Chrome', { tld: 'en.wikipedia.org' }),
    ]
    const { check } = goldenFromScript(script, blocks)
    expect(check.issues).toEqual([
      'step 1: expected TextEdit, got Notes',
      'step 2: expected a drop, got a kept Google Chrome · en.wikipedia.org',
      'step 3: expected a hands-off view, but Google Chrome · en.wikipedia.org had input',
    ])
    expect(check.steps?.map((s) => s.ok)).toEqual([false, false, false])
  })

  it('marks steps with nothing recorded', () => {
    const { check } = goldenFromScript(script, [block(0, 'TextEdit')])
    expect(check.steps?.map((s) => s.got)).toEqual(['TextEdit', null, null])
    expect(check.steps?.[1].issue).toBe('nothing recorded for this step')
  })
})

describe('goldenFromScript with step entry times', () => {
  const span = (
    startSec: number,
    endSec: number,
    appName: string,
    extra: Partial<ReplayActivity> = {},
  ) => block(startSec, appName, { endTimestamp: endSec * 1000, ...extra })
  const calendar = { tld: 'calendar.google.com' }
  const mail = { tld: 'mail.google.com' }
  const twoSites: RecordingScript = {
    id: 'sites',
    title: 'Sites',
    targets: [],
    setup: [],
    steps: [
      {
        instruction: '',
        seconds: 30,
        expect: { app: ['browser'], ...calendar, summary: 'Scheduled.' },
      },
      { instruction: '', seconds: 30, expect: { app: ['browser'], ...mail, summary: 'Drafted.' } },
    ],
  }

  it('keeps unclaimed blocks exactly as the pipeline produced them', () => {
    const blocks = [
      span(0, 0, 'MemoryLane'),
      span(0, 3, 'Wispr Flow', { summaryModel: 'heuristic:viewed', summary: 'Viewed Wispr' }),
      span(3, 7, 'Google Chrome', { tld: 'newtab' }),
      span(7, 34, 'Google Chrome', calendar),
      span(34, 40, 'Google Chrome', { tld: 'newtab' }),
      span(40, 67, 'Google Chrome', mail),
    ]
    const { check, golden } = goldenFromScript(twoSites, blocks, [7000, 40_000], 67_000)
    expect(check.followed).toBe(true)
    expect(check.steps?.map((s) => s.got)).toEqual([
      'Google Chrome · calendar.google.com',
      'Google Chrome · mail.google.com',
    ])
    expect(check.strays).toEqual([
      'MemoryLane',
      'Wispr Flow',
      'Google Chrome · newtab',
      'Google Chrome · newtab',
    ])
    expect(golden?.map((g) => g.summary)).toEqual([
      'live summary',
      'Viewed Wispr',
      'live summary',
      'Scheduled.',
      'live summary',
      'Drafted.',
    ])
    expect(golden?.some((g) => g.dropped)).toBe(false)
  })

  it('keeps every block of a step split by app switches', () => {
    const sheets = { tld: 'docs.google.com' }
    const heyreach = { tld: 'app.heyreach.io' }
    const copy: RecordingScript = {
      ...twoSites,
      steps: [
        {
          instruction: '',
          seconds: 60,
          expect: { app: ['browser'], ...sheets, summary: 'Copied.' },
        },
      ],
    }
    const blocks = [
      span(0, 10, 'Google Chrome', sheets),
      span(10, 15, 'Google Chrome', { ...heyreach, summary: 'Viewed HeyReach' }),
      span(15, 17, 'Google Chrome', {
        ...sheets,
        dropped: { reason: 'too_short', detail: '2000ms < 3000ms' },
      }),
      span(17, 45, 'Google Chrome', sheets),
    ]
    const { check, golden } = goldenFromScript(copy, blocks, [0])
    expect(check.followed).toBe(true)
    expect(golden?.map((g) => [g.startTimestamp, g.endTimestamp, g.summary])).toEqual([
      [0, 10_000, 'live summary'],
      [10_000, 15_000, 'Viewed HeyReach'],
      [15_000, 17_000, 'live summary'],
      [17_000, 45_000, 'Copied.'],
    ])
    expect(golden?.[2].dropped?.reason).toBe('too_short')
  })

  it('reports a step whose block merged into the previous one', () => {
    const blocks = [span(0, 50, 'Google Chrome', calendar)]
    const { check, golden } = goldenFromScript(twoSites, blocks, [0, 30_000])
    expect(check.followed).toBe(false)
    expect(check.steps?.[1].issue).toBe('merged into step 1 (Google Chrome · calendar.google.com)')
    expect(golden).toBeNull()
  })

  it('judges the best-overlapping block when nothing fits', () => {
    const blocks = [
      span(0, 30, 'Google Chrome', calendar),
      span(30, 50, 'Google Chrome', { tld: 'github.com' }),
    ]
    const { check } = goldenFromScript(twoSites, blocks, [0, 30_000])
    expect(check.issues).toEqual([
      'step 2: expected mail.google.com, got Google Chrome · github.com',
    ])
  })

  it('names the dropped same-context block over a longer stray', () => {
    const blocks = [
      span(0, 2, 'Google Chrome', {
        ...calendar,
        dropped: { reason: 'too_short', detail: '2222ms < 3000ms' },
      }),
      span(2, 7, 'Google Chrome', { tld: 'newtab' }),
      span(7, 15, 'Google Chrome', mail),
    ]
    const { check } = goldenFromScript(twoSites, blocks, [0, 7000])
    expect(check.issues).toEqual([
      'step 1: Google Chrome · calendar.google.com was dropped (2222ms < 3000ms)',
    ])
  })

  it('fits a dropped step only to a dropped block', () => {
    const dropped = span(10, 11, 'Google Chrome', {
      dropped: { reason: 'too_short', detail: '900ms' },
    })
    const ok = goldenFromScript(
      script,
      [
        span(0, 10, 'TextEdit'),
        dropped,
        span(11, 30, 'Google Chrome', {
          tld: 'en.wikipedia.org',
          summaryModel: 'heuristic:viewed',
        }),
      ],
      [0, 10_000, 11_000],
    )
    expect(ok.check.followed).toBe(true)
    const kept = goldenFromScript(
      script,
      [
        span(0, 10, 'TextEdit'),
        span(10, 11, 'Google Chrome'),
        span(11, 30, 'Google Chrome', {
          tld: 'en.wikipedia.org',
          summaryModel: 'heuristic:viewed',
        }),
      ],
      [0, 10_000, 11_000],
    )
    expect(kept.check.steps?.[1].issue).toBe('expected a drop, got a kept Google Chrome')
  })

  it('marks steps the operator never reached', () => {
    const { check } = goldenFromScript(twoSites, [span(0, 30, 'Google Chrome', calendar)], [0])
    expect(check.steps?.map((s) => s.issue)).toEqual([null, 'not reached'])
    const none = goldenFromScript(twoSites, [span(0, 30, 'MemoryLane')], [])
    expect(none.check.steps?.map((s) => s.issue)).toEqual(['not reached', 'not reached'])
    expect(none.check.strays).toEqual(['MemoryLane'])
  })
})

describe('mustMentionRecall', () => {
  it('matches case-insensitively and lists misses', () => {
    expect(
      mustMentionRecall('Moved Invoice-4411 into Paid', ['invoice-4411', 'Paid', 'Archive']),
    ).toEqual({
      recall: 2 / 3,
      missed: ['Archive'],
    })
  })
})
