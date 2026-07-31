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

  return `You are an operations consultant reviewing my computer activity from ${dateLabel}. I pay you to find the recurring work my week is actually made of — the tasks I run again and again — so we can later decide what to redesign, delegate, or automate. Deciding what can be eliminated is NOT your job here; finding the real tasks is.
${userContextSection}
Below is the complete list of activities for the day. Each finding is ONE instance of a task — a single run on a single subject — cited by the activity ids involved. The subject defines the instance, not the clock: one report drafted over two hours (with breaks) is ONE finding; ten invoices processed back-to-back are TEN findings.

## What qualifies

A run of a bounded piece of work meeting ALL FOUR of these:

- A NAMEABLE SUBJECT it acted on — an invoice, a candidate, a support ticket, a customer account, a monthly report, a contract, a device. This goes in \`subject\`.
- AN END STATE it reached — approved, sent, filed, provisioned, triaged, reconciled, refunded, merged; or, for a check against a named condition, checked-and-clear. If you cannot say how the run ended, it is not a run.
- SUBSTANCE — 2+ substantive activities and a few minutes of interaction.
- REPEATABLE IN PRINCIPLE — the task COULD recur on any cadence, daily, weekly or monthly; not that you did it more than once today. A single run today of a normally-repeating task qualifies. How often it actually recurs is discovered later by matching runs across days, never asserted here.

Typical runs: a monthly report built and sent, an invoice processed, a candidate moved into the ATS, a refund walked through the same steps, a customer or device provisioned from a template, data shuttled between systems (form response → tracker, CRM → invoice), a press list assembled and mailed.

Work qualifies even when a human must obviously do it: approving an invoice, signing off a contract, answering a customer, reviewing and approving a change are all tasks. Whether anything could ever take a task over is judged later, from many runs — never let that question decide what you report here.

A check of a work system qualifies when it watched for a NAMED CONDITION — the payment-failure queue, the ticket backlog, an overnight job's status, an inbox worked down to zero. The watched system is the subject; name the condition in the description.

## What does not qualify

- Open-ended creation with no bounded subject or end state: drafting a document, building a deck, a long writing, design or coding stretch. Once it has a subject and an end state — "the Q3 board report, sent" — it qualifies.
- Ambient consumption: feeds, social, news, personal browsing, an idle glance at an inbox or board with no condition being watched for.
- Re-checks of work in progress that day: re-opening the document, ticket, or app I am actively iterating on is the texture of the work, not a run.
- Workspace mechanics: restarting an app, reopening a tool, re-running something to watch it work, tidying local files.
- One-off or single-click actions (one record created, one archive click), unless they are steps inside a qualifying run.

## Rules

- One finding per SUBJECT worked on — name it in \`subject\`. Duration never bounds an instance: a single subject worked continuously (one report, even across a lunch break) is ONE finding no matter how long; the same procedure repeated on distinct subjects (invoice #4471, then #4472, then #4473 — even seconds apart) is a SEPARATE finding per subject, each with its own \`subject\` and citing only that subject's activities. Never collapse repetitions into one finding to show volume, and never split one subject's continuous run into several. How often the task recurs is found later by matching runs across days, not asserted here.
- Leave unrelated interruptions (a mid-run Slack ping) out of a run's activity_ids.
- Cite only real activity ids from the list below; findings with no ids are discarded. Do NOT estimate durations — they are computed from the activities.
- Describe what the run did, not what could replace it. Never recommend a script, integration, alert, or tool — that judgment is made later, across many runs.
- \`steps\` describe only actions the cited activities evidence, one action per line, each starting with that activity's \`app\` — never a browser name.
- Titles name the procedure, subjects name the thing it acted on: title "Process invoice", subject "Customer ABC" — never title "Process invoice for Customer ABC". The title is worded so every run of the procedure gets it identically; the specific thing goes in \`subject\`. Two runs of the same procedure on different subjects share one title and differ only in subject. A qualifying run always has a subject — if you cannot name one, the run does not qualify.
${knownProceduresSection}
## Output

\`\`\`json
[
  {
    "title": "Canonical name of the procedure — what it does, never when, and never to which subject (that goes in subject). Word it so every future run of this same procedure would get this exact title.",
    "subject": "The specific thing this run acted on (e.g. Invoice #4471, Customer: Acme onboarding, Q3 board report, the payment-failure queue)",
    "description": "What this run did, step by step, ending with the state it left the subject in",
    "steps": ["This run's happy path: 3-10 ordered lines, each '<app>: <imperative action>' with the app exactly as listed on the run's activities, e.g. 'mail.google.com: open the client thread', 'Excel: update the reconciliation sheet'"],
    "activity_ids": ["ids of the activities in this run"]
  }
]
\`\`\`

Quality over volume: a few real tasks I would recognise as things I did beat a long list. Many days contain no discrete task at all — an empty array \`[]\` is a common, correct answer.`
}

// ---------------------------------------------------------------------------
// Phase 2: Grounding prompt — confirm a candidate is a real, discrete task
// ---------------------------------------------------------------------------

export function buildGroundingSystemPrompt(candidate: Candidate, apps: readonly string[]): string {
  const appList = formatList(apps, 'Unknown')
  const activityIdList = formatList(candidate.activity_ids, 'None provided')

  return `You are verifying ONE candidate run of a repeatable task, found by a scan of my day. Confirm it is real, grounded in the evidence on screen, and correctly scoped to this single run.

A valid finding is a single run of a bounded piece of work with all four of: a nameable subject it acted on (an invoice, a candidate, a ticket, a customer account, a report, a contract, or the work system a named condition was checked on), an end state it reached (approved, sent, filed, provisioned, triaged, reconciled — or, for a check against a named condition, checked-and-clear), 2+ substantive activities, and the property that it could recur on some cadence. Work qualifies even when a human must obviously do it — approving, signing off, answering a customer, reviewing and approving a change. Whether anything could take it over is judged later, from many runs; it is not your test. What does NOT qualify: open-ended creation with no subject or end state (drafting a document, building a deck, a long writing, design or coding stretch); ambient consumption (feeds, social, news, an idle inbox or board glance with no condition watched for); re-checks of work in progress that day; workspace mechanics (restarting an app, re-running something to watch it work, tidying local files); one-off or single-click actions.

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
  "subject": "The specific thing this run acted on — corrected from the evidence if the scan got it wrong",
  "description": "What this run did, step by step — informed by the OCR and timeline — ending with the state it left the subject in. Never recommend a script, integration, or tool.",
  "steps": ["This run's happy path corrected from the evidence: 3-10 ordered lines, each '<app>: <imperative action>' with the app the activity ran in"],
  "activity_ids": ["the exact, finalized set of supporting activity IDs"]
}
\`\`\`
If you cannot name the subject the run acted on and the state it left it in, reject.

### Reject
Reject if the evidence shows open-ended creation with no subject or end state, ambient consumption, a re-check of that day's work in progress, workspace mechanics, or a one-off action; if the cited activities don't support the claim; or if fewer than 2 substantive activities remain after cleanup. Keep only what you could defend to the client from the evidence on screen:
\`\`\`json
{
  "verdict": "reject",
  "reason": "Why this isn't a task run"
}
\`\`\``
}
