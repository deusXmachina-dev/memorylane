import { PositionalAliases } from '@main/llm/id-codec'
import type { ReviewInput, ReviewMerge, ReviewOutput, ReviewSplitGroup } from './types'

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
  output: ReviewOutput | null
  unresolved: number
  mergesIncomplete: boolean
}

export function resolveReviewOutput(output: unknown, aliases: ReviewAliases): ResolvedReview {
  let unresolved = 0
  const unusable = () => ({ output: null, unresolved, mergesIncomplete: false })
  if (!output || typeof output !== 'object' || Array.isArray(output)) return unusable()

  const raw = output as ReviewOutput
  const resolved: ReviewOutput = {}

  const resolveSplit = (split: unknown): ReviewSplitGroup[] | undefined => {
    if (split === undefined) return undefined
    if (!Array.isArray(split)) {
      unresolved++
      return undefined
    }
    return split.map((group) => {
      const { ids, unmapped } = aliases.sightings.decodeMany(group?.sighting_ids)
      unresolved += unmapped
      return { sighting_ids: ids }
    })
  }

  if (raw.clusters !== undefined) {
    if (!Array.isArray(raw.clusters)) return unusable()
    const decoded = raw.clusters.map((verdict) =>
      verdict && typeof verdict === 'object' ? aliases.clusters.decode(verdict.id) : undefined,
    )
    const claims = new Map<string, number>()
    for (const id of decoded) if (id) claims.set(id, (claims.get(id) ?? 0) + 1)
    resolved.clusters = raw.clusters.flatMap((verdict, i) => {
      const id = decoded[i]
      if (!id || (claims.get(id) ?? 0) > 1) {
        unresolved++
        return []
      }
      return [{ ...verdict, id, split: resolveSplit(verdict.split) }]
    })
  }

  let mergesIncomplete = false
  if (raw.merges !== undefined) {
    if (!Array.isArray(raw.merges)) return unusable()
    const merges: ReviewMerge[] = []
    for (const proposal of raw.merges) {
      const { ids, unmapped } = aliases.clusters.decodeMany(proposal?.merge)
      if (unmapped > 0) {
        unresolved += unmapped
        continue
      }
      merges.push({ merge: ids })
    }
    resolved.merges = merges
    mergesIncomplete = merges.length !== raw.merges.length
  }

  return { output: resolved, unresolved, mergesIncomplete }
}
