import { PositionalAliases } from '@main/llm/id-codec'
import type { ReviewInput, ReviewMerge, ReviewOutput } from './types'

export interface ReviewAliases {
  clusters: PositionalAliases
  sightings: PositionalAliases
}

export function aliasReviewInput(input: ReviewInput): {
  input: ReviewInput
  aliases: ReviewAliases
} {
  const aliases: ReviewAliases = {
    clusters: new PositionalAliases('c'),
    sightings: new PositionalAliases('s'),
  }
  return {
    aliases,
    input: {
      clusters: input.clusters.map((cluster) => ({
        ...cluster,
        id: aliases.clusters.encode(cluster.id),
        members: cluster.members.map((member) => ({
          ...member,
          sighting_id: aliases.sightings.encode(member.sighting_id),
        })),
      })),
      mergeCandidates: input.mergeCandidates.map(([a, b]): [string, string] => [
        aliases.clusters.encode(a),
        aliases.clusters.encode(b),
      ]),
    },
  }
}

export interface ResolvedReview {
  /** null = the response's shape is unusable; the caller retries. */
  output: ReviewOutput | null
  /** Id references that could not be read back. */
  unresolved: number
}

export function resolveReviewOutput(output: unknown, aliases: ReviewAliases): ResolvedReview {
  let unresolved = 0
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { output: null, unresolved }
  }

  const raw = output as ReviewOutput
  const resolved: ReviewOutput = {}

  if (raw.clusters !== undefined) {
    if (!Array.isArray(raw.clusters)) return { output: null, unresolved }
    resolved.clusters = raw.clusters.flatMap((verdict) => {
      const id =
        verdict && typeof verdict === 'object' ? aliases.clusters.decode(verdict.id) : undefined
      if (!id) {
        unresolved++
        return []
      }
      if (verdict.split === undefined) return [{ ...verdict, id }]
      if (!Array.isArray(verdict.split)) {
        unresolved++
        return [{ ...verdict, id, split: undefined }]
      }
      const split = verdict.split.map((group) => {
        const decoded = aliases.sightings.decodeMany(group?.sighting_ids)
        unresolved += decoded ? decoded.unmapped : 1
        return { sighting_ids: decoded?.ids ?? [] }
      })
      return [{ ...verdict, id, split }]
    })
  }

  if (raw.merges !== undefined) {
    if (!Array.isArray(raw.merges)) return { output: null, unresolved }
    const merges: ReviewMerge[] = []
    let complete = true
    for (const proposal of raw.merges) {
      const decoded = aliases.clusters.decodeMany(proposal?.merge)
      if (!decoded || decoded.unmapped > 0) {
        unresolved += decoded ? decoded.unmapped : 1
        complete = false
        continue
      }
      merges.push({ merge: decoded.ids })
    }
    resolved.merges = merges
    if (!complete) resolved.mergesComplete = false
  }

  return { output: resolved, unresolved }
}
