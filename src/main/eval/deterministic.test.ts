import { describe, it, expect } from 'vitest'
import { scoreDeterministic, RAW_INTERACTION_RE, META_OPENER_RE } from './deterministic'

function check(summary: string, id: string) {
  return scoreDeterministic(summary).checks.find((c) => c.id === id)!
}

// A clean, rule-abiding summary (~50 words, action-first, single paragraph).
const GOOD =
  'Implemented the token-refresh path in auth-middleware.ts, adding a guard that re-fetches credentials when the access token is expired. Reviewed the failing unit test for the expiry boundary and adjusted the assertion to match the new retry behaviour, then re-ran the suite to confirm the regression was resolved across the affected endpoints.'

describe('scoreDeterministic', () => {
  it('passes every check on a clean summary', () => {
    const result = scoreDeterministic(GOOD)
    expect(result.hardFails).toBe(0)
    expect(result.softWarns).toBe(0)
    expect(result.passRate).toBe(1)
  })

  it('hard-fails an empty summary with a single check', () => {
    const result = scoreDeterministic('')
    expect(result.hardFails).toBe(1)
    expect(result.checks).toHaveLength(1)
    expect(result.checks[0].id).toBe('emptySummary')
  })

  it('hard-fails raw-interaction vocabulary', () => {
    expect(
      check('Clicked the submit button repeatedly to test the flow.', 'noRawInteractionVocab')
        .passed,
    ).toBe(false)
    expect(check(GOOD, 'noRawInteractionVocab').passed).toBe(true)
  })

  it('allows scroll words as reading description', () => {
    expect(
      check('Scrolled through the changelog looking for the regression.', 'noRawInteractionVocab')
        .passed,
    ).toBe(true)
  })

  it('hard-fails meta openers', () => {
    expect(check('During this session the editor was open.', 'noMetaOpener').passed).toBe(false)
    expect(check('The user opened a terminal.', 'noMetaOpener').passed).toBe(false)
    expect(check('In this session, nothing happened.', 'noMetaOpener').passed).toBe(false)
    expect(check(GOOD, 'noMetaOpener').passed).toBe(true)
  })

  it('soft-warns on word count outside 40-100', () => {
    expect(check('Reviewed code.', 'wordCount40to100').passed).toBe(false)
    expect(check('Reviewed code.', 'wordCount40to100').severity).toBe('soft')
  })

  it('soft-warns on bullets and multi-paragraph', () => {
    expect(check('Reviewed code.\n- item one\n- item two', 'noBullets').passed).toBe(false)
    expect(check('Reviewed code.\n\nThen did more.', 'singleParagraph').passed).toBe(false)
  })

  it('treats first person as a soft warning, not a hard fail', () => {
    const result = scoreDeterministic('I implemented the auth guard and reviewed the failing test.')
    const fp = result.checks.find((c) => c.id === 'noFirstPerson')!
    expect(fp.passed).toBe(false)
    expect(fp.severity).toBe('soft')
    // First person alone must not contribute a hard fail.
    expect(result.checks.filter((c) => !c.passed && c.severity === 'hard')).toHaveLength(0)
  })

  it('soft-warns when the opener is not an action verb', () => {
    expect(
      check('Some general activity happened in the editor.', 'startsWithActionVerb').passed,
    ).toBe(false)
    expect(check(GOOD, 'startsWithActionVerb').passed).toBe(true)
  })

  it('regexes are anchored as expected', () => {
    expect(RAW_INTERACTION_RE.test('typing')).toBe(true)
    expect(RAW_INTERACTION_RE.test('typescript')).toBe(false)
    expect(META_OPENER_RE.test('During this session')).toBe(true)
    expect(META_OPENER_RE.test('Reviewed the user guide')).toBe(false)
  })
})
