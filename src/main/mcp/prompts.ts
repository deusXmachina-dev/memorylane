// eslint-disable-next-line import/no-unresolved
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export function buildRecentActivityPromptText(lookback: string): string {
  return (
    `Summarize my recent screen activity from the last ${lookback} minutes.\n\n` +
    'Instructions:\n' +
    `1. Use browse_timeline with startTime "${lookback} minutes ago" and ` +
    'endTime "now", with recent_first sampling and a limit of 50.\n' +
    '2. Use event summaries as the primary evidence for what I was doing.\n' +
    '3. Call get_event_details only for entries where exact OCR text is needed ' +
    '(e.g. commands, filenames, or error messages).\n' +
    '4. Do not infer user activity from OCR alone.\n' +
    '5. Provide a concise narrative summary organized by activity or app.\n' +
    '6. Keep it brief: a short paragraph or a few bullet points is ideal.'
  )
}

export function buildTimeReportPromptText(period: string): string {
  return (
    `Generate a time report for: ${period}\n\n` +
    'Instructions:\n' +
    '1. Use browse_timeline to fetch activity for the period with uniform sampling ' +
    'and a limit of 100-1000.\n' +
    '2. Group work into tasks or projects using summaries as the source of truth.\n' +
    '3. Call get_event_details only when exact OCR text would improve confidence ' +
    '(for example: quoting a command or error string).\n' +
    '4. Never infer activity from OCR alone.\n' +
    '5. Estimate time spent per group using timestamps.\n' +
    '6. Present the report as a table with columns: Time Range, Project/Task, ' +
    'Duration, and Details.\n' +
    '7. Include a total at the bottom and note visible inactivity gaps as breaks.'
  )
}

/**
 * Registers available MCP prompts.
 */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'recent_activity',
    {
      title: 'Recent Activity',
      description:
        'Summarize what the user has been doing recently. ' +
        'Fetches the latest screen activity and provides a concise overview ' +
        'of recent work, useful as context for follow-up tasks.',
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
              text: buildRecentActivityPromptText(lookback),
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
        'Generate a time report summarizing screen activity for a given period. ' +
        'Groups work by project/task with approximate durations.',
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
            text: buildTimeReportPromptText(period),
          },
        },
      ],
    }),
  )
}
