import type { Candidate } from './types'

function formatList(values: readonly string[] | undefined, emptyFallback: string): string {
  if (!Array.isArray(values) || values.length === 0) {
    return emptyFallback
  }
  return values.join(', ')
}

// ---------------------------------------------------------------------------
// Phase 1: Scan prompt — discover discrete task instances
// ---------------------------------------------------------------------------

export function buildScanSystemPrompt(dateLabel: string, userContext?: string): string {
  const userContextSection = userContext ? `\n## My context\n\n${userContext}\n` : ''

  return `You are a task-mining analyst examining my computer activity from ${dateLabel}. Your job is to find *automatable toil*: dumb, repetitive, mechanical things I did that a script, webhook, or agent could do for me.
${userContextSection}
Below you will receive a complete list of activities for the day. Each finding you output is ONE piece of toil, grounded in specific activities — either a discrete task instance (one run of a manual procedure) or a recurring micro-action (the same small thing done over and over).

## What counts as toil

The signal is REPETITION and LOW COGNITIVE LOAD, not complexity. Toil looks different in every profession — bookkeeping, recruiting, PR, support, engineering, operations — but the shape is the same:
- Recurring micro-actions: re-checking a dashboard, inbox, order status, or metrics page; re-opening the same view to see if something changed; repeatedly eyeballing files or folders. Even a 30-second glance counts when it happens again and again.
- Manual procedures run the same way each time: building the same report, processing an invoice batch, onboarding a new client/hire from a template, publishing an update, a routine cleanup
- Copy-pasting or shuttling data between apps (email → spreadsheet, CRM → invoice, form response → tracker)
- Filling out a form/quote/invoice/record with data pulled from elsewhere
- Routine upkeep: approving routine requests, re-running a failed job, archiving or deleting old files/records/emails, tidying folders or boards
- A small mechanical action done only once or twice still counts if a script could do it (e.g. assigning a ticket or task, kicking off a routine job, categorizing a transaction)

NOT toil (skip these):
- Creative or judgment work: writing or editing substantive content (a document, an email to a client, code, a design, a campaign), meaningfully reviewing someone's work, negotiating, analyzing, solving a novel problem — even when that category recurs, each instance needs my brain
- Ambient life: reading email/news, chatting, browsing — no discrete automatable action
- Vague habits with no concrete action ("you use Chrome a lot")

## Grouping rules (important)

- The SAME micro-action repeated across the day — even 20+ times, scattered between other work — is ONE finding whose activity_ids list EVERY occurrence. Do not emit one finding per occurrence, and do not report only the first few occurrences.
- A discrete multi-step task done once = one finding with that run's activities.
- The same multi-step task done several separate times = one finding PER run. Report EVERY run — a procedure that repeats is the strongest automation signal there is.
- Different goals = different findings. Never mix unrelated work in one finding; if an unrelated activity (e.g. a Slack interruption) happened in the middle, leave it OUT.
- A finding with a SINGLE activity_id is valid and encouraged: one-click routine actions (assigning a ticket or task, kicking off a routine job, approving a routine request, deleting/archiving files, categorizing a transaction) are toil even when they show up as one short activity.
- Every finding MUST cite at least one real activity_id from the list below. Findings with no activity_ids will be discarded.

## Final pass (do this before answering)

Re-scan the activities you have NOT cited yet. Any uncited activity that shows a small mechanical action — a one-click routine, a quick status check, a cleanup — gets its own small finding. Small findings are cheap; missed toil is expensive.

## Output

Output your findings as a JSON array:

\`\`\`json
[
  {
    "title": "Short name for the task",
    "description": "What I did, step by step",
    "apps": ["App1", "App2"],
    "activity_ids": ["IDs of the activities that make up this task instance"]
  }
]
\`\`\`

Err on the side of INCLUDING: missing real toil is worse than surfacing a borderline case. Report every recurring micro-action and every mechanical procedure you can ground in activity_ids. Do NOT estimate durations — those are computed from the activities. If there is truly nothing automatable, return an empty array \`[]\`.`
}

// ---------------------------------------------------------------------------
// Phase 2: Grounding prompt — confirm a candidate is a real, discrete task
// ---------------------------------------------------------------------------

export function buildGroundingSystemPrompt(candidate: Candidate): string {
  const appList = formatList(candidate.apps, 'Unknown')
  const activityIdList = formatList(candidate.activity_ids, 'None provided')

  return `You are verifying whether a candidate piece of toil is real and grounded in actual activity. You are NOT matching it against anything — just confirming and tightening this one finding.

Toil = dumb, repetitive, mechanical work a script, webhook, or agent could do — whatever the profession: recurring micro-actions (re-checking a dashboard, inbox, or status page; polling a view; eyeballing files), manual procedures run the same way each time (the same report, invoice batch, or template-driven setup), data shuttling between apps, routine upkeep. A recurring 30-second glance IS toil — do not reject it for being small or "just checking". What is NOT toil: creative or judgment work (writing or editing substantive content, meaningful review, analysis, design) and ambient life (reading, chatting, browsing).

## Candidate (from a superficial scan)
- Title: ${candidate.title}
- Description: ${candidate.description}
- Apps: ${appList}
- Activity IDs from scan: ${activityIdList}

## Your task

Use your tools to investigate:

1. **Read the OCR text** (\`get_activity_ocr\`) for the candidate's activity IDs (up to 5 at a time) to see what was actually on screen.
2. **Browse the timeline** (\`browse_timeline\`) around the activities to see surrounding context and find any activities that belong to this same task but were missed.
3. **Search** (\`search_similar_activities\`) if you need to locate related activities.

Then finalize the finding's **activity_ids**: the exact set of activities that make up this toil. For a recurring micro-action, that means EVERY occurrence across the day — INCLUDE occurrences the scan missed. EXCLUDE unrelated interruptions that happened in between. Do NOT estimate duration — it is computed from the activities you list.

### Keep
If this is genuine toil (a real task instance or a real recurring micro-action):
\`\`\`json
{
  "verdict": "keep",
  "title": "Refined title",
  "description": "What I did, step by step — informed by the OCR and timeline",
  "apps": ["App1", "App2"],
  "activity_ids": ["the exact, finalized set of supporting activity IDs"]
}
\`\`\`

### Reject
Reject ONLY if the activities show creative/judgment work, ambient browsing, or the cited activities don't support the claim. When unsure, keep — a missed real toil is worse than a borderline keep:
\`\`\`json
{
  "verdict": "reject",
  "reason": "Why this isn't real toil"
}
\`\`\``
}
