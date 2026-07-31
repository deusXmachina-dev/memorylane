import { PositionalAliases } from '@main/llm/id-codec'
import type { ReviewInput, ReviewOutput } from './types'

const CLUSTER = 'c'
const SIGHTING = 's'

export function aliasReviewInput(input: ReviewInput): {
  input: ReviewInput
  aliases: PositionalAliases
} {
  const aliases = new PositionalAliases()
  return {
    aliases,
    input: {
      clusters: input.clusters.map((cluster) => ({
        ...cluster,
        id: aliases.encode(CLUSTER, cluster.id),
        members: cluster.members.map((member) => ({
          ...member,
          sighting_id: aliases.encode(SIGHTING, member.sighting_id),
        })),
      })),
      mergeCandidates: input.mergeCandidates.map(([a, b]): [string, string] => [
        aliases.encode(CLUSTER, a),
        aliases.encode(CLUSTER, b),
      ]),
    },
  }
}

export interface ResolvedReview {
  /** null = the response cannot be acted on; the caller retries. */
  output: ReviewOutput | null
  unresolved: number
}

export function resolveReviewOutput(
  output: ReviewOutput,
  aliases: PositionalAliases,
): ResolvedReview {
  const resolved: ReviewOutput = {}
  let unresolved = 0

  if (output.clusters !== undefined) {
    if (!Array.isArray(output.clusters)) return { output: null, unresolved: unresolved + 1 }
    resolved.clusters = output.clusters.flatMap((verdict) => {
      const id = verdict && typeof verdict === 'object' ? aliases.decode(CLUSTER, verdict.id) : null
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
        const decoded = aliases.decodeMany(SIGHTING, group?.sighting_ids)
        unresolved += decoded.unmapped
        return { sighting_ids: decoded.ids }
      })
      return [{ ...verdict, id, split }]
    })
  }

  if (output.merges !== undefined) {
    if (!Array.isArray(output.merges)) return { output: null, unresolved: unresolved + 1 }
    const merges = output.merges.map((proposal) => aliases.decodeMany(CLUSTER, proposal?.merge))
    const unmapped = merges.reduce((sum, m) => sum + m.unmapped, 0)
    if (unmapped > 0) return { output: null, unresolved: unresolved + unmapped }
    resolved.merges = merges.map((m) => ({ merge: m.ids }))
  }

  return { output: resolved, unresolved }
}
