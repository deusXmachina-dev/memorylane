import { describe, it, expect } from 'vitest'
import { parseTaskGoldenMd, renderLabelBlocks, renderTaskGoldenMd } from './task-golden-md'
import type { NewSighting, TaskFixtureActivity } from './task-types'

function act(id: string, app = 'App'): TaskFixtureActivity {
  return {
    id,
    offsetMin: 0,
    durationMin: 5,
    app,
    windowTitle: '',
    tld: null,
    summary: 'did a thing',
    ocrText: '',
  }
}

describe('parseTaskGoldenMd', () => {
  it('parses verdict, title, apps, ids, and description', () => {
    const md = [
      '# Golden tasks — 2026-06-10',
      '',
      '## Submit expense report',
      'Verdict: keep',
      'Apps: Google Chrome, Preview',
      'Activities: a1, a2, a3',
      '',
      'Downloaded receipts and submitted the form.',
      '',
      '---',
    ].join('\n')
    const golden = parseTaskGoldenMd(md)
    expect(golden.sightings).toHaveLength(1)
    const s = golden.sightings[0]
    expect(s.verdict).toBe('keep')
    expect(s.title).toBe('Submit expense report')
    expect(s.apps).toEqual(['Google', 'Chrome', 'Preview'])
    expect(s.activityIds).toEqual(['a1', 'a2', 'a3'])
    expect(s.description).toBe('Downloaded receipts and submitted the form.')
  })

  it('reads keep / reject / unreviewed verdicts', () => {
    const md = [
      '## A',
      'Verdict: keep',
      'Activities: a1',
      '---',
      '## B',
      'Verdict: reject',
      'Activities: b1',
      '---',
      '## C',
      'Verdict: ?',
      'Activities: c1',
    ].join('\n')
    const verdicts = parseTaskGoldenMd(md).sightings.map((s) => `${s.title}:${s.verdict}`)
    expect(verdicts).toEqual(['A:keep', 'B:reject', 'C:unreviewed'])
  })

  it('defaults a block with no Verdict line to keep', () => {
    const md = ['## Hand-authored', 'Activities: a1, a2', 'did work'].join('\n')
    expect(parseTaskGoldenMd(md).sightings[0].verdict).toBe('keep')
  })

  it('skips blocks with no activity ids', () => {
    const md = ['## Example (no ids)', 'Verdict: ?', 'Activities: '].join('\n')
    expect(parseTaskGoldenMd(md).sightings).toHaveLength(0)
  })

  it('ignores the commented day reference appendix', () => {
    const md = renderTaskGoldenMd('2026-06-10', [act('a1'), act('a2')])
    const golden = parseTaskGoldenMd(md)
    expect(golden.sightings).toHaveLength(0)
    expect(md).toContain('a1')
  })
})

describe('renderLabelBlocks', () => {
  it('renders unreviewed blocks that round-trip through the parser', () => {
    const sightings: NewSighting[] = [
      {
        id: 's1',
        title: 'Triage inbox',
        description: 'Archived newsletters.',
        apps: ['Gmail'],
        activityIds: ['g1', 'g2'],
      },
    ]
    const md = renderLabelBlocks(sightings)
    expect(md).toContain('Verdict: ?')
    const parsed = parseTaskGoldenMd(md)
    expect(parsed.sightings).toHaveLength(1)
    expect(parsed.sightings[0].verdict).toBe('unreviewed')
    expect(parsed.sightings[0].activityIds).toEqual(['g1', 'g2'])
    expect(parsed.sightings[0].title).toBe('Triage inbox')
  })
})
