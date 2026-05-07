import type { InteractionContext } from '../../shared/types'
import type { Activity } from '../activity-types'
import type { SemanticMode } from './types'

export function buildSemanticPrompt(
  activity: Activity,
  mode: SemanticMode,
  userContext?: string,
): string {
  const durationMs = Math.max(0, activity.endTimestamp - activity.startTimestamp)
  const durationStr = formatDuration(durationMs)
  const sourceNote =
    mode === 'video'
      ? 'Evidence source: one continuous stitched activity video.'
      : 'Evidence source: sampled snapshots from the activity timeline (not continuous coverage).'

  let prompt =
    'You are summarizing a user activity session from media and interaction timeline.\n\n'

  // Rules first - sets the model behavior before it sees any data.
  prompt += '## Rules\n'
  prompt += '- Media is primary source. Timeline is secondary context for ordering/pacing.\n'
  prompt += '- Answer "What was I working on?" - useful for recall, not a play-by-play.\n'
  prompt +=
    '- NEVER mention raw interactions (clicks, scrolling, key counts). Translate into meaningful actions.\n'
  prompt +=
    '- Be specific: name files, functions, errors, URLs, and UI elements visible in the provided media.\n'
  prompt +=
    '- Match verb intensity to evidence: browsing/reviewing (no visible edits) -> "browsed," "reviewed," "checked." Light editing (small visible changes) -> "tweaked," "adjusted." Active work (sustained edits, new code, debugging) -> "implemented," "debugged," "refactored." Evidence of editing = visible changed lines, new code, or diff markers.\n'
  prompt +=
    '- Do NOT exaggerate. Switching files/tabs = browsing, not editing. Opening a file/page = reviewing, not working on it.\n'
  prompt +=
    '- Distinguish preparation from completion. Seeing a form, dialog, or compose window being filled out is NOT evidence it was submitted. Without visible confirmation (success toast, page redirect, confirmation screen), use preparatory verbs like "started," "drafted," "filled out," "was setting up" — NOT completion verbs like "sent," "submitted," "invited," "created."\n'
  prompt +=
    '- Describe what changed over time: new code, different tabs/pages, updated content, or navigation.\n'
  prompt += '- If evidence is partial, hedge briefly instead of over-claiming.\n'
  prompt +=
    '- 40-100 words, 1-4 sentences, single paragraph, no bullet points. Low-activity sessions should use the lower end.\n'
  prompt +=
    '- Start directly with the action or subject. NEVER start with "During this session", "In this session", "The user", or similar meta-phrases.\n'
  prompt += '\n'

  // Context
  prompt += '## Context\n'
  prompt += `- App: ${activity.context.appName}\n`
  if (activity.context.windowTitle) {
    prompt += `- Window: ${activity.context.windowTitle}\n`
  }
  if (activity.context.tld) {
    prompt += `- TLD: ${activity.context.tld}\n`
  }
  prompt += `- Duration: ${durationStr}\n`
  prompt += `- Start: ${new Date(activity.startTimestamp).toISOString()}\n`
  prompt += `- End: ${new Date(activity.endTimestamp).toISOString()}\n`
  if (userContext) {
    prompt += `- User: ${userContext}\n`
  }
  prompt += `- ${sourceNote}\n\n`

  // Timeline
  const timeline = buildInteractionTimeline(activity)
  if (timeline.length > 0) {
    prompt += '## Activity timeline\n'
    prompt += timeline + '\n\n'
  }

  // Task
  prompt += '## Task\n'
  prompt +=
    'Describe what was worked on. Start mid-sentence with the action (e.g. "Implemented...", "Reviewed...", "Debugged...").\n'

  return prompt
}

function buildInteractionTimeline(activity: Activity): string {
  const interactions = [...activity.interactions].sort((a, b) => a.timestamp - b.timestamp)
  if (interactions.length === 0) {
    return '- No interaction events captured.'
  }

  const maxItems = 16
  const items: string[] = []
  for (const interaction of interactions.slice(0, maxItems)) {
    const offsetSeconds = ((interaction.timestamp - activity.startTimestamp) / 1000).toFixed(1)
    items.push(`- t+${offsetSeconds}s: ${describeInteraction(interaction)}`)
  }

  if (interactions.length > maxItems) {
    items.push(`- ... ${interactions.length - maxItems} additional events omitted`)
  }

  return items.join('\n')
}

function describeInteraction(interaction: InteractionContext): string {
  switch (interaction.type) {
    case 'app_change': {
      const processName = interaction.activeWindow?.processName ?? 'unknown app'
      const title = interaction.activeWindow?.title
      return title ? `app switched to ${processName} (${title})` : `app switched to ${processName}`
    }
    case 'keyboard': {
      const keyCount = interaction.keyCount ?? 0
      return keyCount > 0 ? `typing session (${keyCount} keys)` : 'typing session'
    }
    case 'scroll': {
      return 'scrolling activity'
    }
    case 'click': {
      return 'mouse click'
    }
    default:
      return interaction.type
  }
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}
