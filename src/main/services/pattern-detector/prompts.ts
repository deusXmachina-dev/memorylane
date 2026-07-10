import type { PatternWithStats } from '../../storage/pattern-repository'
import type { Candidate } from './types'

function formatList(values: readonly string[] | undefined, emptyFallback: string): string {
  if (!Array.isArray(values) || values.length === 0) {
    return emptyFallback
  }
  return values.join(', ')
}

// ---------------------------------------------------------------------------
// Phase 1: Scan prompt
// ---------------------------------------------------------------------------

export function buildScanSystemPrompt(
  dateLabel: string,
  rejectedPatterns: PatternWithStats[],
  userContext?: string,
): string {
  const userContextSection = userContext ? `\n## My context\n\n${userContext}\n` : ''

  let rejectedSection = ''
  if (rejectedPatterns.length > 0) {
    const examples = rejectedPatterns
      .map((p) => `- "${p.name}" (${p.apps.join(', ')}) — ${p.description}`)
      .join('\n')
    rejectedSection = `

## Previously rejected patterns (DO NOT detect these again)

I have explicitly rejected these patterns as not useful. Do not output candidates that match or closely resemble them:

${examples}`
  }

  return `You are an automation analyst examining a my computer activity from ${dateLabel}. Your job is to find work that is repetitive, manual, and could be automated away with a script, API call, or tool.
${userContextSection}
Below you will receive a complete list of activities for the day. Analyze them to find automatable patterns.

## What you're looking for

GOOD finds (automatable drudge work):
- Periodically checking values/dashboards and copying them into a spreadsheet or table
- Running the same manual steps repeatedly (e.g., benchmark runs, deploy procedures)
- Filling out forms, quotes, invoices with data that could be pulled from another system
- Copy-pasting data between apps (e.g., CRM → spreadsheet, email → ticket system)
- Repetitive lookup workflows (check status in one app, update in another)
- Manual reporting: gathering numbers from multiple sources into a doc/sheet
- Routine maintenance tasks done the same way each time

BAD finds (not useful, skip these):
- "You write a lot"
- "You check email every morning" — that's just life
- "You use Chrome and Notion" — that's just app usage, not a workflow
- Generic habits like "browse the web" or "write code"
- Any pattern that doesn't have a clear automation opportunity
${rejectedSection}

The key question for each finding: "Could a script, cron job, API integration, or macro do this instead of me?"

## Output

Output your findings as a JSON array:

\`\`\`json
[
  {
    "name": "Short name for the automatable task",
    "description": "What I do manually, step by step",
    "apps": ["App1", "App2"],
    "automation_idea": "How this could be automated (specific: which API, what script, what tool)",
    "confidence": 0.0-1.0,
    "evidence": "What data you saw that supports this — be specific about times, window titles, summaries",
    "activity_ids": ["IDs of activities that demonstrate this pattern"]
  }
]
\`\`\`

Be very selective. Only report things where you genuinely see repeated manual work that a computer could do. 2-3 high-quality finds beats 10 vague ones. If there's nothing automatable, return an empty array \`[]\`.`
}

// ---------------------------------------------------------------------------
// Phase 2: Verification prompt
// ---------------------------------------------------------------------------

export function buildVerificationSystemPrompt(
  candidate: Candidate,
  existingPatterns: PatternWithStats[],
): string {
  const appList = formatList(candidate.apps, 'Unknown')
  const activityIdList = formatList(candidate.activity_ids, 'None provided')

  let patternsSection = ''
  if (existingPatterns.length > 0) {
    const patternsJson = existingPatterns.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      apps: p.apps,
      sighting_count: p.sightingCount,
    }))
    patternsSection = `

## Known patterns

These patterns have been detected before. If the candidate matches one of them, report it as a re-sighting with the pattern's \`id\`.

\`\`\`json
${JSON.stringify(patternsJson, null, 2)}
\`\`\``
  }

  return `You are verifying whether a candidate pattern represents real, automatable, repetitive work.

## Candidate information retrieved from a superficial scan of my activities
- Name: ${candidate.name}
- Description: ${candidate.description}
- Apps: ${appList}
- Activity IDs from initial scan: ${activityIdList}
- Initial confidence: ${candidate.confidence}
${patternsSection}

## Your task

Use your tools to investigate this candidate:

1. **Read the OCR text** (\`get_activity_ocr\`) for a few of the candidate's most relevant activity IDs (fetch up to 5 at a time) to see what was actually on screen.
2. **Search for related activities** (\`search_similar_activities\`) to find activities the initial scan may have missed.
3. **Browse the timeline** (\`browse_timeline\`) around the candidate's time window to see surrounding context and estimate how long the task took.

Then decide one of three outcomes.

Prefer reporting a re-sighting of an existing pattern over creating a new one. If the candidate is related to a known pattern (same workflow, same goal, overlapping apps), treat it as a sighting. Only create a new pattern when it is distinct from everything in the known list.

For verified patterns (new or sighting), also estimate \`duration_estimate_min\`: how many minutes I spent on this particular instance of the task. Base this on the activity durations and timestamps you observe in the evidence.

### 1. Re-sighting of known pattern (preferred)
If this candidate matches or overlaps with an existing known pattern, output:
\`\`\`json
{
  "verdict": "sighting",
  "existing_pattern_id": "ID of the matched known pattern",
  "duration_estimate_min": 5,
  "confidence": 0.0-1.0,
  "evidence": "Why you believe this is the same pattern — specific OCR text, times, cross-day occurrences",
  "activity_ids": ["all supporting activity IDs"],
  "updates": {
    "name": "Updated name if you have a better one (optional)",
    "description": "Updated description if new evidence refines it (optional)",
    "apps": ["Updated app list if this sighting adds new apps (optional)"],
    "automation_idea": "Updated automation idea if you have a better one (optional)"
  }
}
\`\`\`

The \`updates\` object is optional. Include only the fields that should change — omit fields that are fine as-is. Use this to refine pattern details as new evidence comes in.

### 2. New pattern
Only if the candidate is clearly distinct from all known patterns:
\`\`\`json
{
  "verdict": "new",
  "name": "Refined pattern name",
  "description": "What I do manually, step by step — informed by OCR and search results",
  "apps": ["App1", "App2"],
  "automation_idea": "How this could be automated (specific: which API, what script, what tool)",
  "duration_estimate_min": 5,
  "confidence": 0.0-1.0,
  "evidence": "Specific evidence — times, window titles, OCR text snippets, cross-day occurrences",
  "activity_ids": ["all supporting activity IDs"]
}
\`\`\`

### 3. Reject
If the evidence is too thin, the pattern is generic, or there's no real automation opportunity:
\`\`\`json
{
  "verdict": "reject",
  "reason": "Why this isn't a real pattern"
}
\`\`\``
}
