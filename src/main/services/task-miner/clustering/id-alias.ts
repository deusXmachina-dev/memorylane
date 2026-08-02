import { PositionalAliases } from '@main/llm/id-codec'
import type { ReviewInput, ReviewOutput } from './types'

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
  unresolved: number
}

export function resolveReviewOutput(output: ReviewOutput, aliases: ReviewAliases): ResolvedReview {
  const resolved: ReviewOutput = {}
  let unresolved = 0

  if (output.clusters !== undefined) {
    if (!Array.isArray(output.clusters)) return { output: null, unresolved: unresolved + 1 }
    resolved.clusters = output.clusters.flatMap((verdict) => {
      const id = verdict && typeof verdict === 'object' ? aliases.clusters.decode(verdict.id) : null
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
        unresolved += decoded.unmapped
        return { sighting_ids: decoded.ids }
      })
      return [{ ...verdict, id, split }]
    })
  }

  if (output.merges !== undefined) {
    if (!Array.isArray(output.merges)) return { output: null, unresolved: unresolved + 1 }
    const merges = output.merges.map((proposal) => aliases.clusters.decodeMany(proposal?.merge))
    const unmapped = merges.reduce((sum, m) => sum + m.unmapped, 0)
    unresolved += unmapped
    if (unmapped === 0) resolved.merges = merges.map((m) => ({ merge: m.ids }))
  }

  return { output: resolved, unresolved }
}
