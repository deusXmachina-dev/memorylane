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
                '2. Treat event summaries as the primary source of truth for what I did.\n' +
                '3. Only call get_event_details when you need exact strings (for example: an error message, file name, or quoted text).\n' +
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
              '2. Build the report primarily from event summaries (not OCR).\n' +
              '3. Call get_event_details only when exact strings are required to clarify an item.\n' +
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
}
