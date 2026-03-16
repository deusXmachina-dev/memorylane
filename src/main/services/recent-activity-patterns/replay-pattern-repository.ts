import type { PatternRepository } from '../../storage/pattern-repository'

export function createReplayPatternRepository(params: {
  patternRepository: Pick<PatternRepository, 'getAllPatterns' | 'getSightingsForPattern'>
  now: () => number
}): Pick<PatternRepository, 'getAllPatterns' | 'getSightingsForPattern'> {
  return {
    getAllPatterns: () => {
      const now = params.now()
      return params.patternRepository.getAllPatterns().filter((pattern) => pattern.createdAt <= now)
    },
    getSightingsForPattern: (patternId, limit = 20) => {
      const now = params.now()
      const pattern = params.patternRepository
        .getAllPatterns()
        .find((candidate) => candidate.id === patternId && candidate.createdAt <= now)

      if (!pattern) {
        return []
      }

      return params.patternRepository
        .getSightingsForPattern(patternId, Math.max(limit, pattern.sightingCount, 1))
        .filter((sighting) => sighting.detectedAt <= now)
        .slice(0, limit)
    },
  }
}
