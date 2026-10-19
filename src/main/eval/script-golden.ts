import { isBrowserApp } from '@/shared/app-utils'
import {
  isHandsOffStep,
  type RecordingScript,
  type RecordingScriptStep,
  type ScriptCheck,
  type ScriptStepCheck,
} from '@/shared/eval-review'
import type { GoldenSource } from './golden-md'
import type { ReplayActivity } from './types'

export function appMatches(
  expected: string[],
  app: { processName: string; bundleId?: string },
): boolean {
  return expected.some((name) =>
    name === 'browser' ? isBrowserApp(app) : name.toLowerCase() === app.processName.toLowerCase(),
  )
}

function describeBlock(block: ReplayActivity): string {
  return `${block.appName}${block.tld ? ` · ${block.tld}` : ''}`
}

function stepIssue(step: RecordingScriptStep, block: ReplayActivity): string | null {
  const { expect } = step
  const where = describeBlock(block)
  if (!appMatches(expect.app, { processName: block.appName }))
    return `expected ${expect.app.join('/')}, got ${where}`
  if (expect.tld && expect.tld !== block.tld) return `expected ${expect.tld}, got ${where}`
  if (expect.dropped && !block.dropped) return `expected a drop, got a kept ${where}`
  if (!expect.dropped && block.dropped) return `${where} was dropped (${block.dropped.detail})`
  if (isHandsOffStep(step) && !block.summaryModel.startsWith('heuristic:')) {
    return `expected a hands-off view, but ${where} had input`
  }
  return null
}

function withStepTarget(step: RecordingScriptStep, block: ReplayActivity): GoldenSource {
  if (block.dropped || !step.expect.summary) return block
  return { ...block, summary: step.expect.summary, mustMention: step.expect.mustMention }
}

function longest(blocks: ReplayActivity[]): ReplayActivity {
  return blocks.reduce((a, b) =>
    b.endTimestamp - b.startTimestamp > a.endTimestamp - a.startTimestamp ? b : a,
  )
}

function overlap(block: ReplayActivity, start: number, end: number): number {
  return Math.min(block.endTimestamp, end) - Math.max(block.startTimestamp, start)
}

/**
 * Aligns a script's steps to the recorded blocks. The golden keeps every block
 * exactly as the pipeline produced it; the script only labels them. With
 * `stepEnteredAt` (the recorder's per-step entry times) each step owns the span
 * until the next entry and claims the blocks in it that fit; the longest one
 * takes the step's target summary. Without it, blocks pair with steps by position.
 */
export function goldenFromScript(
  script: RecordingScript,
  blocks: ReplayActivity[],
  stepEnteredAt?: number[],
  leftAt?: number,
): { check: ScriptCheck; golden: GoldenSource[] | null } {
  const sorted = [...blocks].sort((a, b) => a.startTimestamp - b.startTimestamp)
  return stepEnteredAt
    ? alignBySpans(script, sorted, stepEnteredAt, leftAt)
    : alignByPosition(script, sorted)
}

function alignBySpans(
  script: RecordingScript,
  sorted: ReplayActivity[],
  enteredAt: number[],
  leftAt: number | undefined,
): { check: ScriptCheck; golden: GoldenSource[] | null } {
  const claimed = new Map<ReplayActivity, number>()
  const targets = new Map<ReplayActivity, RecordingScriptStep>()
  const steps: ScriptStepCheck[] = script.steps.map((step, i) => {
    const start = enteredAt[i]
    if (start === undefined) return { ok: false, got: null, issue: 'not reached' }
    const end = enteredAt[i + 1] ?? leftAt ?? Infinity
    const inSpan = sorted.filter((b) => b.endTimestamp > start && b.startTimestamp < end)
    const fitting = inSpan.filter((b) => !claimed.has(b) && stepIssue(step, b) === null)
    if (fitting.length > 0) {
      for (const b of fitting) claimed.set(b, i)
      targets.set(longest(fitting), step)
      return { ok: true, got: describeBlock(fitting[0]), issue: null }
    }
    for (const b of inSpan) {
      const owner = claimed.get(b)
      if (owner !== undefined) {
        return {
          ok: false,
          got: describeBlock(b),
          issue: `merged into step ${owner + 1} (${describeBlock(b)})`,
        }
      }
    }
    const sameContext = inSpan.filter(
      (b) =>
        appMatches(step.expect.app, { processName: b.appName }) &&
        (!step.expect.tld || step.expect.tld === b.tld),
    )
    const best = (sameContext.length > 0 ? sameContext : inSpan).reduce<ReplayActivity | null>(
      (acc, b) => (acc && overlap(acc, start, end) >= overlap(b, start, end) ? acc : b),
      null,
    )
    if (best) return { ok: false, got: describeBlock(best), issue: stepIssue(step, best) }
    return { ok: false, got: null, issue: 'nothing recorded for this step' }
  })

  const strays = sorted.filter((b) => !claimed.has(b))
  const issues = steps.flatMap((s, i) => (s.issue ? [`step ${i + 1}: ${s.issue}`] : []))
  const check: ScriptCheck = {
    scriptId: script.id,
    followed: issues.length === 0,
    expected: script.steps.length,
    produced: sorted.length,
    issues,
    steps,
    strays: strays.map(describeBlock),
  }
  if (!check.followed) return { check, golden: null }
  const golden = sorted.map((b) => {
    const step = targets.get(b)
    return step ? withStepTarget(step, b) : b
  })
  return { check, golden }
}

function alignByPosition(
  script: RecordingScript,
  sorted: ReplayActivity[],
): { check: ScriptCheck; golden: GoldenSource[] | null } {
  const issues: string[] = []
  if (sorted.length !== script.steps.length) {
    issues.push(`expected ${script.steps.length} activities, got ${sorted.length}`)
  }
  const steps: ScriptStepCheck[] = script.steps.map((step, i) => {
    const block = sorted[i]
    if (!block) return { ok: false, got: null, issue: 'nothing recorded for this step' }
    const issue = stepIssue(step, block)
    if (issue) issues.push(`step ${i + 1}: ${issue}`)
    return { ok: issue === null, got: describeBlock(block), issue }
  })

  const check: ScriptCheck = {
    scriptId: script.id,
    followed: issues.length === 0,
    expected: script.steps.length,
    produced: sorted.length,
    issues,
    steps,
  }
  if (!check.followed) return { check, golden: null }

  const golden = sorted.map((block, i) => {
    const { expect } = script.steps[i]
    if (block.dropped || !expect.summary) return block
    return { ...block, summary: expect.summary, mustMention: expect.mustMention }
  })
  return { check, golden }
}
