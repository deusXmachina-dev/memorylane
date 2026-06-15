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

  return `You are a task-mining analyst examining my computer activity from ${dateLabel}. Your job is to find discrete *task instances* — concrete things I did that look like repetitive, manual work a computer could do for me.
${userContextSection}
Below you will receive a complete list of activities for the day. Each finding you output is ONE task instance: a single coherent unit of work pursuing one goal, grounded in specific activities.

## What counts as a task instance

GOOD (one coherent, automatable unit of work):
- Checking a value/dashboard and copying it into a spreadsheet or table
- Running the same manual procedure (a benchmark, a deploy, a report build)
- Filling out a form/quote/invoice with data pulled from elsewhere
- Copy-pasting data between apps (CRM → spreadsheet, email → ticket)
- A lookup-then-update workflow across two apps

BAD (skip these):
- "You write a lot" / "you browse the web" / "you use Chrome and Notion" — habits, not tasks
- "Check email every morning" — that's just life
- Anything with no clear automation opportunity

## Granularity rules (important)

- One finding = one coherent task instance. Do NOT bundle unrelated work into a single finding.
- If two different goals happened back-to-back, emit them as SEPARATE findings.
- List ONLY the activity_ids that are genuinely part of that one task. If an unrelated activity
  (e.g. a Slack interruption) happened in the middle, leave it OUT.
- Every finding MUST cite at least one real activity_id from the list below. Findings with no
  activity_ids will be discarded.

## Output

Output your findings as a JSON array:

\`\`\`json
[
  {
    "title": "Short name for the task",
    "description": "What I did, step by step",
    "apps": ["App1", "App2"],
    "confidence": 0.0-1.0,
    "activity_ids": ["IDs of the activities that make up this task instance"]
  }
]
\`\`\`

Be selective. A few well-grounded task instances beat many vague ones. Do NOT estimate durations —
those are computed from the activities. If there's nothing automatable, return an empty array \`[]\`.`
}

// ---------------------------------------------------------------------------
// Phase 2: Grounding prompt — confirm a candidate is a real, discrete task
// ---------------------------------------------------------------------------

export function buildGroundingSystemPrompt(candidate: Candidate): string {
  const appList = formatList(candidate.apps, 'Unknown')
  const activityIdList = formatList(candidate.activity_ids, 'None provided')

  return `You are verifying whether a candidate task instance is real, discrete, and grounded in actual activity. You are NOT matching it against anything — just confirming and tightening this one task.

## Candidate (from a superficial scan)
- Title: ${candidate.title}
- Description: ${candidate.description}
- Apps: ${appList}
- Activity IDs from scan: ${activityIdList}
- Initial confidence: ${candidate.confidence}

## Your task

Use your tools to investigate:

1. **Read the OCR text** (\`get_activity_ocr\`) for the candidate's activity IDs (up to 5 at a time) to see what was actually on screen.
2. **Browse the timeline** (\`browse_timeline\`) around the activities to see surrounding context and find any activities that belong to this same task but were missed.
3. **Search** (\`search_similar_activities\`) if you need to locate related activities.

Then finalize the task's **activity_ids**: the exact set of activities that make up this one coherent
task instance. INCLUDE activities the scan missed; EXCLUDE unrelated interruptions that happened in
between. Do NOT estimate duration — it is computed from the activities you list.

### Keep
If this is a genuine, discrete, automatable task instance:
\`\`\`json
{
  "verdict": "keep",
  "title": "Refined title",
  "description": "What I did, step by step — informed by the OCR and timeline",
  "apps": ["App1", "App2"],
  "confidence": 0.0-1.0,
  "activity_ids": ["the exact, finalized set of supporting activity IDs"]
}
\`\`\`

### Reject
If the evidence is thin, the task is generic, or there's no real automation opportunity:
\`\`\`json
{
  "verdict": "reject",
  "reason": "Why this isn't a real, discrete task"
}
\`\`\``
}
