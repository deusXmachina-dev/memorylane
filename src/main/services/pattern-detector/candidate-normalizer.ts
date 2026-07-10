import { z } from 'zod'
import type { Candidate } from './types'

const scanCandidateSchema = z.object({
  name: z.preprocess((value) => (typeof value === 'string' ? value.trim() : ''), z.string().min(1)),
  description: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : ''),
    z.string().min(1),
  ),
  apps: z
    .preprocess(
      (value) =>
        Array.isArray(value)
          ? value
              .filter((item): item is string => typeof item === 'string')
              .map((item) => item.trim())
              .filter((item) => item.length > 0)
          : [],
      z.array(z.string()),
    )
    .default([]),
  activity_ids: z
    .preprocess(
      (value) =>
        Array.isArray(value)
          ? value
              .filter((item): item is string => typeof item === 'string')
              .map((item) => item.trim())
              .filter((item) => item.length > 0)
          : [],
      z.array(z.string()),
    )
    .default([]),
  confidence: z
    .preprocess((value) => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.min(1, value))
      }
      return 0.5
    }, z.number())
    .default(0.5),
  automation_idea: z.preprocess(
    (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined),
    z.string().optional(),
  ),
  evidence: z.preprocess(
    (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined),
    z.string().optional(),
  ),
  existing_pattern_id: z.preprocess(
    (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined),
    z.string().optional(),
  ),
})

export function normalizeScanCandidates(raw: unknown[]): {
  candidates: Candidate[]
  malformedCount: number
  missingActivityIdsCount: number
} {
  const candidates: Candidate[] = []
  let malformedCount = 0
  let missingActivityIdsCount = 0

  for (const item of raw) {
    const parsed = scanCandidateSchema.safeParse(item)
    if (!parsed.success) {
      malformedCount++
      continue
    }

    const candidate: Candidate = parsed.data
    if (candidate.activity_ids.length === 0) {
      missingActivityIdsCount++
    }
    candidates.push(candidate)
  }

  return { candidates, malformedCount, missingActivityIdsCount }
}
