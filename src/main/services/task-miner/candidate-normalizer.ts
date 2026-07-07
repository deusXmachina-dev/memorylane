import { z } from 'zod'
import type { Candidate } from './types'

const scanCandidateSchema = z.object({
  title: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : ''),
    z.string().min(1),
  ),
  // The object the run acted on. A forcing function for one-instance-per-object
  // separation, but tolerated when the model omits it — activity_ids is the hard
  // anchor, not this.
  subject: z
    .preprocess((value) => (typeof value === 'string' ? value.trim() : ''), z.string())
    .default(''),
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
})

export function normalizeScanCandidates(raw: unknown[]): {
  candidates: Candidate[]
  malformedCount: number
  droppedNoActivityIds: number
} {
  const candidates: Candidate[] = []
  let malformedCount = 0
  let droppedNoActivityIds = 0

  for (const item of raw) {
    const parsed = scanCandidateSchema.safeParse(item)
    if (!parsed.success) {
      malformedCount++
      continue
    }

    const candidate: Candidate = parsed.data
    // A sighting must be grounded in real activities — that's the verifiable
    // recall handle. Drop candidates the scan couldn't anchor to any activity.
    if (candidate.activity_ids.length === 0) {
      droppedNoActivityIds++
      continue
    }
    candidates.push(candidate)
  }

  return { candidates, malformedCount, droppedNoActivityIds }
}
