import type { EvalFixtureSummary, RecordingScript } from '@/shared/eval-review'

export type ScenarioStatus = 'todo' | 'redo' | 'done'

export interface Scenario {
  script: RecordingScript
  status: ScenarioStatus
  /** This scenario's recordings, newest first. */
  fixtures: EvalFixtureSummary[]
  /** Recordings that matched the script. */
  recorded: number
}

export function buildScenarios(
  scripts: RecordingScript[],
  fixtures: EvalFixtureSummary[],
): Scenario[] {
  return scripts.map((script) => {
    const own = fixtures.filter((f) => f.scriptId === script.id)
    const recorded = own.filter((f) => f.scriptFollowed).length
    const status: ScenarioStatus = recorded > 0 ? 'done' : own.length > 0 ? 'redo' : 'todo'
    return { script, status, fixtures: own, recorded }
  })
}

/** First scenario still to record, else the first to redo. */
export function nextScenario(scenarios: Scenario[], skipId?: string): Scenario | null {
  const open = scenarios.filter((s) => s.script.id !== skipId)
  return open.find((s) => s.status === 'todo') ?? open.find((s) => s.status === 'redo') ?? null
}

export function scriptSeconds(script: RecordingScript): number {
  return script.steps.reduce((sum, step) => sum + step.seconds, 0)
}
