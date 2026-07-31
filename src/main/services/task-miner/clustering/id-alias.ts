import { PositionalAliases } from '@main/llm/id-codec'
import type { ReviewInput, ReviewOutput } from './types'

const CLUSTER = 'c'
const SIGHTING = 's'

/** Swap every cluster and sighting uuid in the payload for a short handle. */
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

/**
 * Map the response back to real ids. A verdict whose own id won't decode is
 * dropped — it can't be attributed to a cluster. Undecodable sighting ids fall
 * out of their split group, leaving the degenerate-split guard to handle it.
 *
 * A merges array holding any undecodable id loses the whole key: applyStructure
 * reads a response without "merges" as degenerate and declines nothing, which
 * is what an unreadable id should mean. Recording declines off a response we
 * can only half-read would suppress the very pairs the model asked to merge,
 * for the full decline TTL.
 */
export function resolveReviewOutput(
  output: ReviewOutput,
  aliases: PositionalAliases,
): ReviewOutput {
  const resolved: ReviewOutput = {}

  if (output.clusters) {
    resolved.clusters = output.clusters.flatMap((verdict) => {
      const id = aliases.decode(verdict.id ?? '')
      if (!id) return []
      if (!verdict.split) return [{ ...verdict, id }]
      return [
        {
          ...verdict,
          id,
          split: verdict.split.map((group) => ({
            sighting_ids: aliases.decodeMany(group.sighting_ids ?? []).ids,
          })),
        },
      ]
    })
  }

  if (output.merges) {
    const merges = output.merges.map((proposal) => aliases.decodeMany(proposal.merge ?? []))
    if (!merges.some((m) => m.unmapped > 0)) {
      resolved.merges = merges.map((m) => ({ merge: m.ids }))
    }
  }

  return resolved
}
