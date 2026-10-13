import { describe, expect, it } from 'vitest'
import type { EvalFixtureSummary, RecordingScript } from '@/shared/eval-review'
import { buildScenarios, nextScenario } from './scenarios'

const script = (id: string): RecordingScript => ({
  id,
  title: id,
  targets: [],
  setup: [],
  steps: [],
})

const fixture = (scriptId: string, scriptFollowed: boolean): EvalFixtureSummary => ({
  name: `${scriptId}-${String(scriptFollowed)}`,
  label: '',
  capturedAt: '',
  frameCount: 0,
  eventWindowCount: 0,
  appMix: [],
  hasVideo: true,
  scriptId,
  scriptFollowed,
})

describe('buildScenarios', () => {
  const scenarios = buildScenarios(
    [script('a'), script('b'), script('c')],
    [fixture('a', true), fixture('a', false), fixture('b', false)],
  )

  it('derives status from matched recordings', () => {
    expect(scenarios.map((s) => [s.status, s.recorded])).toEqual([
      ['done', 1],
      ['redo', 0],
      ['todo', 0],
    ])
  })

  it('suggests unrecorded scenarios before redos', () => {
    expect(nextScenario(scenarios)?.script.id).toBe('c')
    expect(nextScenario(scenarios, 'c')?.script.id).toBe('b')
  })
})
