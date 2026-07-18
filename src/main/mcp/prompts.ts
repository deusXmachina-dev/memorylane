// eslint-disable-next-line import/no-unresolved
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

/**
 * Registers available MCP prompts.
 */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'recent_activity',
    {
      title: 'Recent Activity',
      description:
        'Summarize what the user has been doing recently using summary-first reasoning. ' +
        'Fetches recent activity summaries and only uses OCR when exact text recall is needed.',
      argsSchema: {
        minutes: z
          .string()
          .optional()
          .describe(
            'How many minutes of recent activity to look back. Defaults to "30". ' +
              'Examples: "15", "30", "60", "120"',
          ),
      },
    },
    ({ minutes }) => {
      const lookback = minutes || '30'
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text:
                `Summarize my recent screen activity from the last ${lookback} minutes.\n\n` +
                'Instructions:\n' +
                `1. Use browse_timeline with startTime "${lookback} minutes ago" and ` +
                'endTime "now", with recent_first sampling and a limit of 50.\n' +
                '2. Treat activity summaries as the primary source of truth for what I did.\n' +
                '3. Only call get_activity_details when you need exact strings (for example: an error message, file name, or quoted text).\n' +
                '4. Do not infer activity from OCR alone; use OCR only as supporting exact-text evidence.\n' +
                '5. Provide a concise narrative summary of what I have been working on, organized by activity or app.\n' +
                '6. Highlight notable items (e.g. errors, context switches, repeated focus) and label any OCR-based details as exact on-screen text.\n' +
                '7. Keep it brief: a short paragraph or a few bullet points is ideal.',
            },
          },
        ],
      }
    },
  )

  server.registerPrompt(
    'time_report',
    {
      title: 'Time Report',
      description:
        'Generate a summary-first time report for a given period. ' +
        'Groups work by project/task with approximate durations and uses OCR only for exact recall details.',
      argsSchema: {
        period: z
          .string()
          .describe(
            'Time period for the report, in natural language. ' +
              'Examples: "today", "yesterday", "this week", "last Monday", "Feb 3 to Feb 7"',
          ),
      },
    },
    ({ period }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `Generate a time report for: ${period}\n\n` +
              'Instructions:\n' +
              '1. Use browse_timeline to fetch activity for the period with uniform sampling ' +
              'and a limit of 100-1000.\n' +
              '2. Build the report primarily from activity summaries (not OCR).\n' +
              '3. Call get_activity_details only when exact strings are required to clarify an item.\n' +
              '4. Do not infer projects/tasks from OCR alone.\n' +
              '5. Group the activity into tasks or projects based on summary evidence, app, and timestamps.\n' +
              '6. Estimate the time spent on each group using the timestamps.\n' +
              '7. Present the report as a table with columns: Time Range, Project/Task, ' +
              'Duration, and Details.\n' +
              '8. Include a total at the bottom.\n' +
              '9. If there are gaps with no recorded activity, note them as breaks.\n' +
              '10. If you include OCR excerpts, clearly mark them as exact on-screen text.',
          },
        },
      ],
    }),
  )

  server.registerPrompt(
    'automate_patterns',
    {
      title: 'Automate Patterns',
      description:
        'Review detected workflow patterns and generate Claude Code skill files for each ' +
        'automatable pattern so Claude can ' +
        'execute them automatically next time the pattern is triggered.',
      argsSchema: {
        focus: z
          .string()
          .optional()
          .describe(
            'Optional focus area to narrow the review. ' +
              'Examples: "most frequent", "Chrome workflows", "all"',
          ),
      },
    },
    ({ focus }) => {
      const focusLine = focus ? `\nFocus area: ${focus}` : ''
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text:
                `Look at my detected workflow patterns and automate everything you can.${focusLine}\n\n` +
                '## Step 1 — Discover\n\n' +
                'Call list_patterns to get all recurring task patterns with stats.\n' +
                'For the top patterns (by times seen), call get_pattern_details to ' +
                'see the individual runs and the "Replace with" recommendation stored with the pattern.\n' +
                'For recent runs, call get_activity_details on their activity IDs ' +
                'to read the OCR evidence — this shows exactly what was on screen.\n' +
                'If a pattern is still unclear, use browse_timeline around the run timestamps ' +
                '(±15 minutes) to see what happened before and after for more context.\n\n' +
                '## Step 2 — Check existing skills\n\n' +
                'Before creating anything, check what skills already exist. ' +
                'Look for existing skill files and compare them against the detected patterns. ' +
                'If a pattern already has a matching skill, skip it — do not recreate it. ' +
                'Only proceed to step 3 for patterns that have no existing skill.\n\n' +
                '## Step 3 — Triage\n\n' +
                'For each pattern that lacks an existing skill, quickly decide:\n' +
                '- **Automatable**: You can build a skill that does the thing (or most of it) ' +
                'next time it comes up. Proceed to step 4.\n' +
                '- **Not automatable**: The pattern is just normal work, requires too much ' +
                'creative judgment, or has fewer than 2 runs. Skip it — mention it in ' +
                'the summary with a one-line reason.\n\n' +
                'Be honest. "User writes code in VS Code" is not automatable. ' +
                '"User copies Jira ticket ID, creates git branch, opens PR template" is.\n\n' +
                '## Step 4 — Generate skills\n\n' +
                'For each automatable pattern, use the skill-creator skill you have to create a new skill. ' +
                'Provide it with a clear description of what the skill should do, based on:\n' +
                '- The pattern name and description\n' +
                '- The "Replace with" recommendation stored with the pattern (when present)\n' +
                '- Any additional context from runs or activity details\n\n' +
                'Let the skill-creator handle the file format and placement. ' +
                'Just give it the best possible brief of what the skill needs to accomplish.\n\n' +
                '## Step 5 — Report\n\n' +
                'After writing all skill files, give a brief summary:\n' +
                '- Which patterns already had skills (no action needed)\n' +
                '- Which patterns got new skills (with the `/skill-name` to invoke each)\n' +
                '- Which patterns were skipped and why\n' +
                '- Any patterns that are close to automatable but need more sightings first',
            },
          },
        ],
      }
    },
  )
}
