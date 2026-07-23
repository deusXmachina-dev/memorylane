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

export function buildScanSystemPrompt(
  dateLabel: string,
  userContext?: string,
  knownProcedures?: readonly string[],
): string {
  const userContextSection = userContext ? `\n## My context\n\n${userContext}\n` : ''
  const knownProceduresSection =
    knownProcedures && knownProcedures.length > 0
      ? `\n## Known procedures\n\nTitles of recurring procedures already established on previous days:\n${knownProcedures
          .map((t) => `- ${t}`)
          .join(
            '\n',
          )}\n\nThese are names, not evidence: nothing qualifies as a finding because it appears here, and the rules above decide what qualifies exactly as if this list were empty. When a qualifying run IS another instance of one of these procedures, reuse the known title EXACTLY as written and put what distinguishes this run in \`subject\`. When it is a different procedure — even a similar-sounding one — coin a fresh canonical title; never stretch a known title to cover different work.\n`
      : ''

  return `You are an operations consultant reviewing my computer activity from ${dateLabel}. I pay you to recommend eliminations I would actually build: repeatable, meaningful work that a script, an integration, an alert, or an internal-platform feature could take over. A finding exists only if you can name that mechanism — no mechanism, no finding.
${userContextSection}
Below is the complete list of activities for the day. Each finding is ONE instance of eliminable work — a single run of a task on a single object — cited by the activity ids involved. The object defines the instance, not the clock: one report drafted over two hours (with breaks) is ONE finding; ten invoices processed back-to-back are TEN findings.

## What qualifies

A run of a repeatable multi-step procedure that CHANGES something — creates, processes, moves, configures, fixes. A monthly report built, an invoice batch processed, a candidate moved into the ATS, a refund walked through the same steps, a device or customer provisioned from a template, data shuttled between systems (form response → tracker, CRM → invoice), a press list assembled and mailed, a flaky job re-run and confirmed. Repeatable means the task COULD recur on any cadence — daily, weekly, monthly — not that you did it more than once today; a single run today of a normally-repeating task qualifies. How often it actually recurs is discovered later by matching runs across days, never asserted here. A real run has substance: 2+ substantive activities and a few minutes of interaction. Mechanism: script, integration, or platform feature.

## What does not qualify — the client will not pay for these

- Checking and watching: inbox, chat, social feeds, news, calendars, dashboards, status pages, usage meters. Watching changes nothing — it is not a task, however often it happens.
- Re-checks of work in progress that day: re-opening the PR, doc, or app I am actively iterating on is the texture of the work, not eliminable.
- Dev-loop mechanics: server restarts, git housekeeping, terminal clears, worktree or local-db cleanup — normal workflow.
- One-off or single-click actions (one issue created, one archive click), unless they are steps inside a qualifying run.
- Creative or judgment work: writing, coding, review, analysis, design, negotiation — recurring or not, each instance needs a human.

## Rules

- One finding per OBJECT worked on — name it in \`subject\`. Duration never bounds an instance: a single object worked continuously (one report, even across a lunch break) is ONE finding no matter how long; the same procedure repeated on distinct objects (invoice #4471, then #4472, then #4473 — even seconds apart) is a SEPARATE finding per object, each with its own \`subject\` and citing only that object's activities. Never collapse repetitions into one finding to show volume, and never split one object's continuous run into several. How often the task recurs is found later by matching runs across days, not asserted here.
- Leave unrelated interruptions (a mid-run Slack ping) out of a run's activity_ids.
- Cite only real activity ids from the list below; findings with no ids are discarded. Do NOT estimate durations — they are computed from the activities.
- Every description ENDS with exactly one sentence naming the mechanism: "Replace with: <the concrete script, integration, alert, or platform feature>." If you cannot write that sentence concretely, the finding does not exist.
- \`steps\` describe only actions the cited activities evidence, one action per line, each starting with that activity's \`app\` — never a browser name.
- Titles name the procedure, subjects name the object: title "Process invoice", subject "Customer ABC" — never title "Process invoice for Customer ABC". The title is worded so every run of the procedure gets it identically; the specific object goes in \`subject\`. Two runs of the same procedure on different objects share one title and differ only in subject. \`subject\` is optional — leave it empty when the run acted on no single nameable object.
${knownProceduresSection}
## Output

\`\`\`json
[
  {
    "title": "Canonical name of the procedure — what it does, never when, and never to which object (that goes in subject). Word it so every future run of this same procedure would get this exact title.",
    "subject": "Optional. The specific object this run acted on (e.g. Invoice #4471, Customer: Acme onboarding, Q3 board report); empty string if the run acted on no single nameable object",
    "description": "What this run did, step by step, ending with: Replace with: <the concrete script, integration, alert, or platform feature>.",
    "steps": ["This run's happy path: 3-10 ordered lines, each '<app>: <imperative action>' with the app exactly as listed on the run's activities, e.g. 'mail.google.com: open the client thread', 'Ghostty: run the deploy command'"],
    "activity_ids": ["ids of the activities in this run"]
  }
]
\`\`\`

Quality over volume: a few findings I would actually build beat a long list. Many days contain no meaningful eliminable work — an empty array \`[]\` is a common, correct answer.`
}

// ---------------------------------------------------------------------------
// Phase 2: Grounding prompt — confirm a candidate is a real, discrete task
// ---------------------------------------------------------------------------

export function buildGroundingSystemPrompt(candidate: Candidate, apps: readonly string[]): string {
  const appList = formatList(apps, 'Unknown')
  const activityIdList = formatList(candidate.activity_ids, 'None provided')

  return `You are verifying ONE candidate run of a repeatable task, found by a scan of my day. Confirm it is real, grounded in the evidence on screen, and correctly scoped to this single run.

A valid finding is a single run of a repeatable multi-step procedure that CHANGES something — creates, processes, moves, configures, fixes — with 2+ substantive activities and a nameable elimination mechanism (a concrete script, integration, alert, or platform feature). What does NOT qualify: checking and watching (inbox, chat, feeds, dashboards, status pages); re-checks of work in progress that day; dev-loop mechanics (server restarts, git housekeeping); one-off or single-click actions; creative or judgment work (writing, coding, review, analysis, design).

## Candidate (from a superficial scan)
- Title: ${candidate.title}
- Description: ${candidate.description}
- Apps: ${appList}
- Activity IDs from scan: ${activityIdList}

## Your task

Use your tools to investigate:

1. **Read the OCR text** (\`get_activity_ocr\`) for the candidate's activity IDs (up to 5 at a time) to see what was actually on screen.
2. **Browse the timeline** (\`browse_timeline\`) around the activities to see surrounding context and find any activities that belong to this same run but were missed.
3. **Search** (\`search_similar_activities\`) if you need to locate related activities.

Then finalize the finding's **activity_ids** — this finding is ONE run on ONE object (\`${candidate.subject || candidate.title}\`). Do NOT add other occurrences of the same task on other objects from elsewhere in the day; each run is verified separately. You MAY add activities the scan missed that belong to THIS object's run, and you MUST drop unrelated interruptions (a mid-run Slack ping). A long continuous run on one object stays one finding even across breaks. Do NOT estimate duration — it is computed from the activities you list.

### Keep
If this is a real, grounded run:
\`\`\`json
{
  "verdict": "keep",
  "title": "Refined title",
  "subject": "The specific object this run acted on — corrected from the evidence if the scan got it wrong",
  "description": "What this run did, step by step — informed by the OCR and timeline — ENDING with exactly one sentence: Replace with: <the concrete script, integration, alert, or platform feature>.",
  "steps": ["This run's happy path corrected from the evidence: 3-10 ordered lines, each '<app>: <imperative action>' with the app the activity ran in"],
  "activity_ids": ["the exact, finalized set of supporting activity IDs"]
}
\`\`\`
If you cannot write the "Replace with:" sentence concretely, reject.

### Reject
Reject if the evidence shows checking/watching, re-checks of that day's work in progress, dev-loop mechanics, a one-off action, creative or judgment work; if the cited activities don't support the claim; or if fewer than 2 substantive activities remain after cleanup. Keep only what you could defend to the client from the evidence on screen:
\`\`\`json
{
  "verdict": "reject",
  "reason": "Why this isn't an eliminable run"
}
\`\`\``
}
