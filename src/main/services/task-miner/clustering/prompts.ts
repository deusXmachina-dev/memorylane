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
- "clusters": clusters needing review. Each has an id, a "new" flag (true = created just now by an automatic grouping pass), an existing "label" (may be empty), "stats" computed from ALL members (times_seen, span_days from first to last sighting, median_active_min), "replace_with" (candidate elimination mechanisms carried by member sightings, may be empty), and sample member sightings (title, description, apps, interaction minutes, date).
- "merge_candidates": pairs of cluster ids that MAY be the same process. These are the only merges you are allowed to propose.

Your tasks:
1. LABEL every cluster listed in "clusters" that is not part of a merge you propose: give it a "label" (short imperative noun phrase naming the process, e.g. "Process weekly invoice batch") and a "description" (1-2 sentences describing what the process typically looks like, step by step where visible).
2. CLASSIFY every cluster you label — "kind" is one of:
   - "procedure": a repeatable multi-step process that changes something and could be taken over by a concrete mechanism.
   - "monitoring": checking or watching — inboxes, dashboards, statuses, feeds. Never eliminable, however often it recurs.
   - "ambient": everyday life — chat, social, news, calendar, browsing.
   - "dev-loop": software-development inner-loop mechanics — restarts, reruns, git housekeeping.
   - "judgment": creative or judgment work — writing, coding, review, analysis, design. Never eliminable; each instance needs a human.
   For "procedure" also output "mechanism_kind" ("script" | "integration" | "alert" | "platform_feature" | "process_change") and "mechanism": ONE sentence naming the concrete replacement. Consolidate it from the cluster's "replace_with" entries and what the member descriptions show — never invent a mechanism the evidence doesn't support. No concrete mechanism = not a procedure. For every other kind use "mechanism_kind": "none" and omit "mechanism".
3. MERGE: for each merge candidate pair that is genuinely the same recurring process, output a merge with the combined label and description. Only use pairs from "merge_candidates". Chains are fine (if A+B and B+C, output one merge of A, B, C).
4. SPLIT: if a cluster marked "new": true clearly mixes two or more unrelated processes, split it into groups. Only split clusters marked new. Assign each listed sighting_id to exactly one group.

Rules:
- Never invent cluster ids or sighting ids not present in the input.
- Do not mention counts, frequencies, or durations in labels/descriptions — those are computed separately.
- When unsure whether two clusters are the same process, do NOT merge; leaving them apart is recoverable, merging is not.
- When unsure of the kind, choose the non-eliminable reading — a wrongly promised automation costs more than a missed one.

Output a single JSON object, no other text:

\`\`\`json
{
  "clusters": [
    { "id": "<cluster id>", "label": "...", "description": "...", "kind": "procedure", "mechanism_kind": "integration", "mechanism": "..." },
    { "id": "<cluster id>", "label": "...", "description": "...", "kind": "monitoring", "mechanism_kind": "none" },
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
