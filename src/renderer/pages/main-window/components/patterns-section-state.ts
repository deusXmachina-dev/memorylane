import type { PatternInfo } from '@types'

function sortReviewedPatterns(patterns: PatternInfo[]): PatternInfo[] {
  return [...patterns].sort((a, b) => {
    const aCompleted = a.completedAt !== null ? 1 : 0
    const bCompleted = b.completedAt !== null ? 1 : 0
    if (aCompleted !== bCompleted) return aCompleted - bCompleted
    return b.sightingCount - a.sightingCount
  })
}

export function getPatternsSectionState(
  allPatterns: PatternInfo[] | null,
  minSightings: number,
): {
  newPatterns: PatternInfo[]
  approvedPatterns: PatternInfo[]
  reviewedPatterns: PatternInfo[]
} {
  const newPatterns = allPatterns?.filter((pattern) => pattern.approvedAt === null) ?? []
  const approvedPatterns = sortReviewedPatterns(
    allPatterns?.filter((pattern) => pattern.approvedAt !== null) ?? [],
  )
  const reviewedPatterns = approvedPatterns.filter(
    (pattern) => pattern.sightingCount >= minSightings,
  )

  return {
    newPatterns,
    approvedPatterns,
    reviewedPatterns,
  }
}
