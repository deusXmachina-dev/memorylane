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
