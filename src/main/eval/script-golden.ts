import { isBrowserApp } from '@/shared/app-utils'
import type { RecordingScript, RecordingScriptStep, ScriptCheck } from '../../shared/eval-review'
import type { GoldenSource } from './golden-md'
import type { ReplayActivity } from './types'

function appMatches(expected: string[], appName: string): boolean {
  return expected.some((app) =>
    app === 'browser'
      ? isBrowserApp({ processName: appName })
      : app.toLowerCase() === appName.toLowerCase(),
  )
}

function stepIssue(step: RecordingScriptStep, block: ReplayActivity): string | null {
  const { expect } = step
  const where = `${block.appName}${block.tld ? ` · ${block.tld}` : ''}`
  if (!appMatches(expect.app, block.appName))
    return `expected ${expect.app.join('/')}, got ${where}`
  if (expect.tld && expect.tld !== block.tld) return `expected ${expect.tld}, got ${where}`
  if (expect.dropped && !block.dropped) return `expected a drop, got a kept ${where}`
  if (!expect.dropped && block.dropped) return `${where} was dropped (${block.dropped.detail})`
  if (!expect.dropped && !expect.summary && !block.summaryModel.startsWith('heuristic:')) {
    return `expected a hands-off view, but ${where} had input`
  }
  return null
}

/**
 * Aligns a script's steps to the recorded blocks (kept + dropped) in time
 * order. When every step matches, the golden takes times from the recording
 * and text from the script; otherwise there is no golden and the check lists
 * what diverged.
 */
export function goldenFromScript(
  script: RecordingScript,
  blocks: ReplayActivity[],
): { check: ScriptCheck; golden: GoldenSource[] | null } {
  const sorted = [...blocks].sort((a, b) => a.startTimestamp - b.startTimestamp)
  const issues: string[] = []
  if (sorted.length !== script.steps.length) {
    issues.push(`expected ${script.steps.length} activities, got ${sorted.length}`)
  }
  const n = Math.min(sorted.length, script.steps.length)
  for (let i = 0; i < n; i++) {
    const issue = stepIssue(script.steps[i], sorted[i])
    if (issue) issues.push(`step ${i + 1}: ${issue}`)
  }

  const check: ScriptCheck = {
    scriptId: script.id,
    followed: issues.length === 0,
    expected: script.steps.length,
    produced: sorted.length,
    issues,
  }
  if (!check.followed) return { check, golden: null }

  const golden = sorted.map((block, i) => {
    const { expect } = script.steps[i]
    if (block.dropped || !expect.summary) return block
    return { ...block, summary: expect.summary, mustMention: expect.mustMention }
  })
  return { check, golden }
}
