import { z } from 'zod'
import type { Candidate } from './types'

const MAX_STEPS = 15
const MAX_STEP_LEN = 200

/**
 * Whitelist an LLM-emitted step/variable list (shape, count/length caps),
 * optionally transforming entries (e.g. PII scrub) before the length cap.
 * Anything unusable normalizes to [] and never fails the candidate — steps
 * are progressive enhancement. Scan steps are stored raw; scrub at egress.
 */
export function normalizeSteps(
  value: unknown,
  opts: { cap?: number; transform?: (entry: string) => string } = {},
): string[] {
  const { cap = MAX_STEPS, transform } = opts
  return (Array.isArray(value) ? value : [])
    .filter((s): s is string => typeof s === 'string')
    .map((s) => (transform ? transform(s.trim()) : s.trim()).slice(0, MAX_STEP_LEN))
    .filter((s) => s.length > 0)
    .slice(0, cap)
}

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
  steps: z.preprocess((value) => normalizeSteps(value), z.array(z.string())).default([]),
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
