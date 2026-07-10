import { describe, expect, it } from 'vitest'
import type { PatternInfo } from '@types'
import { getPatternsSectionState } from './patterns-section-state'

function createPattern(overrides: Partial<PatternInfo> = {}): PatternInfo {
  return {
    id: overrides.id ?? 'pattern-1',
    name: overrides.name ?? 'Pattern',
    description: overrides.description ?? 'Pattern description',
    apps: overrides.apps ?? ['Chrome'],
    automationIdea: overrides.automationIdea ?? 'Automate it',
    createdAt: overrides.createdAt ?? 1,
    rejectedAt: overrides.rejectedAt ?? null,
    promptCopiedAt: overrides.promptCopiedAt ?? null,
    approvedAt: overrides.approvedAt ?? null,
    completedAt: overrides.completedAt ?? null,
    sightingCount: overrides.sightingCount ?? 1,
    lastSeenAt: overrides.lastSeenAt ?? null,
    lastConfidence: overrides.lastConfidence ?? null,
    estimatedHoursPerWeek: overrides.estimatedHoursPerWeek ?? null,
  }
}

describe('getPatternsSectionState', () => {
  it('keeps approved low-sighting patterns available even when the active filter hides them', () => {
    const lowSightingApproved = createPattern({
      id: 'approved-low',
      approvedAt: 100,
      sightingCount: 1,
    })

    const state = getPatternsSectionState([lowSightingApproved], 3)

    expect(state.approvedPatterns).toHaveLength(1)
    expect(state.approvedPatterns[0]?.id).toBe('approved-low')
    expect(state.reviewedPatterns).toHaveLength(0)
  })

  it('sorts approved patterns before applying the sightings threshold', () => {
    const incomplete = createPattern({
      id: 'incomplete',
      approvedAt: 100,
      completedAt: null,
      sightingCount: 5,
    })
    const completed = createPattern({
      id: 'completed',
      approvedAt: 101,
      completedAt: 200,
      sightingCount: 9,
    })

    const state = getPatternsSectionState([completed, incomplete], 3)

    expect(state.approvedPatterns.map((pattern) => pattern.id)).toEqual(['incomplete', 'completed'])
    expect(state.reviewedPatterns.map((pattern) => pattern.id)).toEqual(['incomplete', 'completed'])
  })
})
