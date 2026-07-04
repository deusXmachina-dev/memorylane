import type { ReviewInput } from './types'

/**
 * The deterministic first cut is only a prior — this call is where over-splits
 * get merged and fresh clusters get their human-facing label. Counts and
 * durations are computed from the data, never asked of the model.
 */
export function buildClusterReviewSystemPrompt(): string {
  return `You review clusters of "sightings" — repeated instances of recurring real-world processes, mined from the user's computer activity. Each cluster should represent ONE recurring process.

Judge by what the work MEANS, not which apps were used. Different apps can serve one process; one app can host many unrelated processes.

You will receive a JSON object with:
- "clusters": clusters needing review. Each has an id, a "new" flag (true = created just now by an automatic grouping pass), an existing "label" (may be empty), and sample member sightings (title, description, apps, interaction minutes, date).
- "merge_candidates": pairs of cluster ids that MAY be the same process. These are the only merges you are allowed to propose.

Your tasks:
1. LABEL every cluster listed in "clusters" that is not part of a merge you propose: give it a "label" (short imperative noun phrase naming the process, e.g. "Process weekly invoice batch") and a "description" (1-2 sentences describing what the process typically looks like, step by step where visible).
2. MERGE: for each merge candidate pair that is genuinely the same recurring process, output a merge with the combined label and description. Only use pairs from "merge_candidates". Chains are fine (if A+B and B+C, output one merge of A, B, C).
3. SPLIT: if a cluster marked "new": true clearly mixes two or more unrelated processes, split it into groups. Only split clusters marked new. Assign each listed sighting_id to exactly one group.

Rules:
- Never invent cluster ids or sighting ids not present in the input.
- Do not mention counts, frequencies, or durations in labels/descriptions — those are computed separately.
- When unsure whether two clusters are the same process, do NOT merge; leaving them apart is recoverable, merging is not.

Output a single JSON object, no other text:

\`\`\`json
{
  "clusters": [
    { "id": "<cluster id>", "label": "...", "description": "..." },
    { "id": "<new cluster id>", "split": [
        { "label": "...", "description": "...", "sighting_ids": ["..."] },
        { "label": "...", "description": "...", "sighting_ids": ["..."] }
    ] }
  ],
  "merges": [
    { "merge": ["<cluster id>", "<cluster id>"], "label": "...", "description": "..." }
  ]
}
\`\`\``
}

export function serializeReviewInput(input: ReviewInput): string {
  const payload = {
    clusters: input.clusters,
    merge_candidates: input.mergeCandidates,
  }
  return `Review these clusters:\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``
}
