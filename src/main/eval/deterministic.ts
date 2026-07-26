import type { DeterministicCheck, DeterministicResult } from './types'

/**
 * Pure, zero-cost checks derived strictly from the summarizer's `## Rules`
 * (semantic/prompt.ts, mirrored in prompt-registry's baseline rules). No LLM.
 *
 * Hard failures (raw-interaction vocabulary, meta openers, empty output) are
 * unambiguous rule violations and feed the report's hard-fail count. Everything
 * else is a soft warning — the prompt expresses them as guidance (word count,
 * sentence count, single paragraph, action-verb opener) and the LLM judge
 * grades the nuance.
 */

// "NEVER mention raw interactions (clicks, scrolling, key counts)." Scroll words
// are exempt: goldens use them to describe reading, so only event-log vocabulary
// hard-fails.
export const RAW_INTERACTION_RE =
  /\b(click(?:ed|ing|s)?|typed|typing|keystrokes?|keypress(?:es)?|key\s?counts?|keys?\s+(?:pressed|typed)|pressed\s+(?:a\s+)?key|mouse|cursor|double-click)\b/i

// "NEVER start with 'During this session', 'In this session', 'The user', ..."
export const META_OPENER_RE = /^\s*(during|in)\s+this\s+session\b|^\s*the\s+user\b/i

// Bullet/list markers (prompt requires a single paragraph, no bullet points).
const BULLET_LINE_RE = /^\s*([-*•]|\d+[.)])\s+/m

// First-person markers (prompt does NOT forbid these -> soft warn only).
const FIRST_PERSON_RE = /\b(I|I'm|I've|I'd|I'll|my|we|we're|we've|our)\b/

// Allowlisted action-verb openers (past tense + a few gerund/imperatives).
const ACTION_VERB_OPENERS = new Set([
  'implemented',
  'debugged',
  'refactored',
  'reviewed',
  'browsed',
  'checked',
  'tweaked',
  'adjusted',
  'edited',
  'wrote',
  'read',
  'inspected',
  'explored',
  'navigated',
  'searched',
  'configured',
  'updated',
  'fixed',
  'added',
  'removed',
  'created',
  'drafted',
  'started',
  'opened',
  'examined',
  'tested',
  'ran',
  'investigated',
  'compared',
  'analyzed',
  'set',
  'filled',
  'viewed',
  'watched',
  'scanned',
  'switched',
  'compiled',
  'built',
  'deployed',
  'merged',
])

function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

function countSentences(text: string): number {
  const matches = text.trim().match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g)
  return matches ? matches.filter((s) => s.trim().length > 0).length : 0
}

function firstWord(text: string): string {
  const m = text.trim().match(/^[a-zA-Z']+/)
  return m ? m[0].toLowerCase() : ''
}

export function scoreDeterministic(summary: string): DeterministicResult {
  const text = summary ?? ''
  const checks: DeterministicCheck[] = []

  if (text.trim().length === 0) {
    checks.push({
      id: 'emptySummary',
      passed: false,
      severity: 'hard',
      detail: 'Summary is empty (the summarizer produced no output).',
    })
    return finalize(checks)
  }

  const rawMatch = text.match(RAW_INTERACTION_RE)
  checks.push({
    id: 'noRawInteractionVocab',
    passed: rawMatch === null,
    severity: 'hard',
    detail: rawMatch ? `Mentions raw interaction: "${rawMatch[0]}"` : undefined,
  })

  const metaMatch = META_OPENER_RE.test(text)
  checks.push({
    id: 'noMetaOpener',
    passed: !metaMatch,
    severity: 'hard',
    detail: metaMatch
      ? 'Starts with a meta-opener ("During this session" / "The user").'
      : undefined,
  })

  const words = countWords(text)
  checks.push({
    id: 'wordCount40to100',
    passed: words >= 40 && words <= 100,
    severity: 'soft',
    detail: words >= 40 && words <= 100 ? undefined : `${words} words (target 40-100).`,
  })

  const sentences = countSentences(text)
  checks.push({
    id: 'sentenceCount1to4',
    passed: sentences >= 1 && sentences <= 4,
    severity: 'soft',
    detail: sentences >= 1 && sentences <= 4 ? undefined : `${sentences} sentences (target 1-4).`,
  })

  const singleParagraph = !/\n\s*\n/.test(text.trim())
  checks.push({
    id: 'singleParagraph',
    passed: singleParagraph,
    severity: 'soft',
    detail: singleParagraph ? undefined : 'Contains a blank line (multiple paragraphs).',
  })

  const hasBullets = BULLET_LINE_RE.test(text)
  checks.push({
    id: 'noBullets',
    passed: !hasBullets,
    severity: 'soft',
    detail: hasBullets ? 'Contains bullet/list markers.' : undefined,
  })

  const opener = firstWord(text)
  const startsWithVerb = ACTION_VERB_OPENERS.has(opener) || /ed$|ing$/.test(opener)
  checks.push({
    id: 'startsWithActionVerb',
    passed: startsWithVerb,
    severity: 'soft',
    detail: startsWithVerb ? undefined : `Opens with "${opener}" (expected an action verb).`,
  })

  const firstPerson = FIRST_PERSON_RE.test(text)
  checks.push({
    id: 'noFirstPerson',
    passed: !firstPerson,
    severity: 'soft',
    detail: firstPerson ? 'Uses first person (allowed, but unusual for this prompt).' : undefined,
  })

  return finalize(checks)
}

function finalize(checks: DeterministicCheck[]): DeterministicResult {
  const hardFails = checks.filter((c) => !c.passed && c.severity === 'hard').length
  const softWarns = checks.filter((c) => !c.passed && c.severity === 'soft').length
  const passed = checks.filter((c) => c.passed).length
  return {
    checks,
    hardFails,
    softWarns,
    passRate: checks.length === 0 ? 1 : passed / checks.length,
  }
}
