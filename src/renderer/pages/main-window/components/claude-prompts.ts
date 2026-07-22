import type { ClusterInfo, ClusterSightingInfo } from '@types'
import { scrubPII } from '@/shared/sanitize'
import { formatFrequency, formatSightingTime } from './activities/format'

/** Clipboard prompts for the "Analyze with Claude" / "Build AI agent" buttons.
 * The analyze prompt is NOT scrubbed: activity ids are UUIDs, and
 * scrubPII's id/phone patterns would corrupt all-digit segments (DEU-207
 * tracks the egress-scrub redesign). */

export function buildClusterAnalyzePrompt(
  cluster: ClusterInfo,
  sightings: ClusterSightingInfo[],
): string {
  const recent = sightings.slice(0, 5)
  const sampleActivityIds = recent.flatMap((s) => s.activityIds).slice(0, 20)
  const hasIds = sampleActivityIds.length > 0
  const lines = [
    `Here's a recurring task I'd like to explore: "${cluster.title}".`,
    ``,
    cluster.description ? `Context: ${cluster.description}` : null,
    `Apps involved: ${cluster.apps.join(', ') || 'unknown'}.`,
    cluster.timesPerWeek > 0
      ? `I do this about ${formatFrequency(cluster.timesPerWeek)} (${cluster.timesSeen} runs over ${cluster.observedDays} active days); a run takes ~${Math.round(cluster.avgActiveMin)} min of hands-on work.`
      : `I've done this ${cluster.timesSeen} time${cluster.timesSeen === 1 ? '' : 's'}; a run takes ~${Math.round(cluster.avgActiveMin)} min of hands-on work.`,
    ``,
    ...(hasIds ? [`Activity IDs for research: ${sampleActivityIds.join(', ')}.`, ``] : []),
    `Recent occurrences:`,
    ...recent.map(
      (s) => `- ${formatSightingTime(s.startedAt)}: ${s.title}${s.subject ? `, ${s.subject}` : ''}`,
    ),
    ``,
    `## Choose a path`,
    ``,
    `Use AskUserQuestion to ask me:`,
    `1. **Build a Claude Skill** to automate this task`,
    `2. **Analyze this pattern** to understand the workflow in detail`,
    ``,
    `---`,
    ``,
    `## Path 1: Build a Claude Skill`,
    ``,
    `### Research`,
    `Use the MemoryLane MCP tools to understand what this task really involves:`,
    ...(hasIds
      ? [
          `1. Call get_activity_details on the activity IDs above to read the OCR evidence of what I actually did.`,
          `2. Call browse_timeline around those timestamps (±15 minutes) to see the full workflow.`,
        ]
      : [
          `1. Call browse_timeline around the occurrences above (±15 minutes) to see the full workflow.`,
        ]),
    ``,
    `### Ask me questions`,
    `Before building, ask me:`,
    `- Which steps vary between occurrences?`,
    `- What inputs or variables are needed?`,
    `- What tools, APIs, or services do I have available?`,
    ``,
    `Wait for my answers, then create a Claude skill (a SKILL.md file with YAML frontmatter: name, description, allowed-tools, and step-by-step instructions). Save it and tell me where it was saved.`,
    ``,
    `---`,
    ``,
    `## Path 2: Analyze this pattern`,
    ``,
    `### Quick analysis`,
    `Use the MemoryLane MCP tools:`,
    ...(hasIds
      ? [
          `1. Call get_activity_details on the activity IDs above.`,
          `2. Call browse_timeline around those timestamps (±15 minutes).`,
        ]
      : [`1. Call browse_timeline around the occurrences above (±15 minutes).`]),
    ``,
    `Then summarize:`,
    `- Step-by-step workflow (activity level, not click level)`,
    `- Time per app per run`,
    `- What varies vs what stays constant across runs`,
    `- Rough automatable rating: low / medium / high`,
    ``,
    `### What next?`,
    `After the summary, use AskUserQuestion:`,
    `1. **Build a Claude Skill** (skip research since you already did it, go straight to asking me questions from Path 1, then create the SKILL.md)`,
    `2. **Run deep ROI analysis** (deep dive with time/cost quantification and automation recommendations)`,
    `3. **I'm done, thanks**`,
    ``,
    `If "Run deep ROI analysis": invoke /process-analyst-new focused on this pattern.`,
    `If /process-analyst-new is not available, suggest I install the MemoryLane plugin for Claude (it includes the process analyst skill for deep workflow analysis and a reporting skill to generate shareable reports). Then offer to run a lighter analysis inline using the MCP tools instead (decompose steps, estimate time per step, flag what looks automatable).`,
  ]
  return lines.filter((l) => l !== null).join('\n')
}

/** Tool-agnostic prompt built from the stored, de-identified recipe;
 * scrubPII runs over the final string as a last-mile net. */
export function buildClusterAgentPrompt(cluster: ClusterInfo): string {
  const lines: string[] = [
    `Build an AI agent that automates this task.`,
    ``,
    `Goal: ${cluster.description || cluster.title}`,
    ``,
  ]
  if (cluster.steps.length > 0) {
    lines.push(`Step-by-step:`)
    cluster.steps.forEach((step, i) => lines.push(`${i + 1}. ${step}`))
  } else {
    lines.push(
      `Apps: ${cluster.apps.join(', ') || 'unknown'}. Work out the steps, then confirm with me.`,
    )
  }
  if (cluster.variables.length > 0) {
    lines.push(``, `Changes each run: ${cluster.variables.join(', ')}.`)
  }
  lines.push(``, `Before building, ask me:`)
  if (cluster.variables.length === 0) {
    lines.push(`- Which steps or inputs change each run?`)
  }
  lines.push(
    `- What tools and API access are available?`,
    `- What should happen when a step fails?`,
    ``,
    `Then build it and tell me how to run it.`,
  )
  return scrubPII(lines.join('\n'))
}

