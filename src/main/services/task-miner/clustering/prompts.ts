import type { ReviewInput } from './types'

/**
 * The structure half of the review: adjudicate merge candidates and splits
 * over groups the deterministic first cut produced. Labels and recipes are
 * deliberately out of scope — the content round writes those after membership
 * settles, so this call's output stays small enough to never time out.
 */
export function buildStructureReviewSystemPrompt(): string {
  return `You review clusters of "sightings" — repeated instances of recurring real-world processes, mined from the user's computer activity. Each cluster should represent ONE recurring process. Your only job is structure: adjudicate merges and splits. Labels and recipes are written by a separate step — never output them.

Judge by what the work MEANS, not which apps were used. Different apps can serve one process; one app can host many unrelated processes.

You will receive a JSON object with:
- "clusters": the clusters involved. Each has an id, a "splittable" flag (true = may be split; shown with an extended member sample), an existing "label" (may be empty), "stats" computed from ALL members (times_seen, span_days from first to last sighting, median_active_min), and member sightings (title, subject (the specific object that run acted on), description, apps (app identities: the website host for web work, e.g. "dashboard.stripe.com", the application name for desktop work, e.g. "Ghostty"), "active_min" (measured hands-on time at the screen, excluding time spent in other apps), date, and "steps" — that run's observed happy path).
- "merge_candidates": pairs of cluster ids that MAY be the same process. These are the only merges you are allowed to propose.

Your tasks:
1. MERGE: for each merge candidate pair that is genuinely the same recurring process, output it in "merges". Only use pairs from "merge_candidates". Merge more than two clusters at once ONLY if every pair among them is listed in "merge_candidates" — never chain (A+B and B+C does not justify merging A with C).
2. SPLIT: if a cluster marked "splittable": true mixes two or more unrelated processes, split it into groups of sighting ids. Only split clusters marked splittable. Assign each listed sighting_id to exactly one group.
3. FLAG: if a cluster marked "splittable": true mixes unrelated processes and you cannot split it cleanly, output { "id": ..., "incoherent": true } instead of a split — it will be re-grouped automatically.

Rules:
- Never invent cluster ids or sighting ids not present in the input.
- When unsure whether two clusters are the same process, do NOT merge; leaving them apart is recoverable, merging is not.
- Always output both keys, even when empty: no merges → "merges": [], no splits or flags → "clusters": [].

Output a single JSON object, no other text:

\`\`\`json
{
  "clusters": [
    { "id": "<splittable cluster id>", "split": [
        { "sighting_ids": ["..."] },
        { "sighting_ids": ["..."] }
    ] },
    { "id": "<cluster id>", "incoherent": true }
  ],
  "merges": [
    { "merge": ["<cluster id>", "<cluster id>"] }
  ]
}
\`\`\``
}

/**
 * The content half of the review: name, classify, and write the recipe for
 * every cluster shown — new clusters, clusters whose recipe a merge or split
 * cleared, and clusters that doubled since their last labeling. No merges or
 * splits are offered, so it cannot restructure anything.
 */
export function buildContentReviewSystemPrompt(): string {
  return `You label clusters of "sightings" — repeated instances of recurring real-world processes, mined from the user's computer activity. Each cluster represents ONE recurring process.

You will receive a JSON object with "clusters". Each has an id, an existing "label" (may be empty), "stats" computed from ALL members (times_seen, span_days from first to last sighting, median_active_min), and member sightings (title, subject (the specific object that run acted on), description, apps (app identities: the website host for web work, e.g. "dashboard.stripe.com", the application name for desktop work, e.g. "Ghostty"), "active_min" (measured hands-on time at the screen, excluding time spent in other apps), date, and "steps" — that run's observed happy path). Members sharing a title but differing in subject are the same process run on different objects, direct evidence for adopting that shared title as the label.

Output a verdict for EVERY cluster listed — a cluster missing from your output stays unlabeled:
1. LABEL: keep a non-empty existing "label" verbatim unless it misnames the process — established names are load-bearing. For an unlabeled cluster give a short imperative noun phrase naming the process (e.g. "Process weekly invoice batch"); when the member sightings already share one exact title, adopt that title verbatim instead of paraphrasing it. Labels may repeat across clusters that act on different subjects; do not contort a label to force uniqueness. Always output "label" and "description" (1-2 sentences describing what the process typically looks like, step by step where visible).
2. CLASSIFY: "kind" is one of:
   - "procedure": a repeatable multi-step process that changes something and could be taken over by a concrete mechanism.
   - "monitoring": checking or watching — inboxes, dashboards, statuses, feeds. Never eliminable, however often it recurs.
   - "ambient": everyday life — chat, social, news, calendar, browsing.
   - "dev-loop": software-development inner-loop mechanics — restarts, reruns, git housekeeping.
   - "judgment": creative or judgment work — writing, coding, review, analysis, design. Never eliminable; each instance needs a human.
   For "procedure" also output "mechanism": ONE sentence naming the concrete replacement (a script, integration, alert, platform feature, or process change). Consolidate it from the "Replace with:" sentences in the member descriptions — never invent a mechanism the evidence doesn't support. No concrete mechanism = not a procedure. For every other kind omit "mechanism".
3. RECIPE: every verdict MUST carry "steps" and "variables" — this applies equally when the cluster already has a label. "steps" is an ordered, generalized how-to for the process: 3 to 12 short lines, each starting with an app identity from the member sightings' apps, then a colon and the imperative action. For a website, a recognizable product name may precede the host in parentheses — "Gmail (mail.google.com): open the client thread" — otherwise use the host alone: "dashboard.stripe.com: locate the customer profile". For a desktop app use its name: "Ghostty: run the deploy command". Never use a browser name as the app. Steps describe only actions the member sightings evidence; consolidate from the members' observed "steps" first — they are raw single runs: generalize across them and move their specifics into "variables". When runs used different mechanisms, generalize to the recurring one — do not canonicalize one run's incidental flow. "variables" lists the things that differ from run to run, named generically (e.g. "customer name", "invoice number", "search term"). This recipe is copied into outside automation tools, so it MUST be fully de-identified: never write a real person, company, email, phone number, account number, or url-with-id. Write "enter the customer name", never "enter ACME Inc"; move every changing specific into "variables" as a generic label.

Rules:
- Never invent cluster ids not present in the input.
- Do not mention counts, frequencies, or durations in labels/descriptions — those are computed separately.
- When unsure of the kind, choose the non-eliminable reading — a wrongly promised automation costs more than a missed one.
- steps and variables carry NO personal data: no real names, companies, emails, phone numbers, ids, or PII/PHI. When in doubt, replace the specific with a generic variable.

Output a single JSON object, no other text:

\`\`\`json
{
  "clusters": [
    { "id": "<cluster id>", "label": "...", "description": "...", "kind": "procedure", "mechanism": "...", "steps": ["Gmail (mail.google.com): ...", "Ghostty: ..."], "variables": ["customer name", "..."] },
    { "id": "<cluster id>", "label": "...", "description": "...", "kind": "monitoring", "steps": ["dashboard.stripe.com: ...", "..."], "variables": ["..."] }
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
