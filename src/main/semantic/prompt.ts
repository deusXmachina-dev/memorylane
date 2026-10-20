import type { ClickClass, InteractionContext, KeyClass } from '../../shared/types'
import type { Activity } from '@main/activity/activity-types'
import { isPassiveView } from '@main/activity/passive-view'
import { scrubPII } from '@/shared/sanitize'
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
    '- NEVER transcribe credentials, API keys, tax file / Medicare / IRD / NHI numbers, bank accounts, card numbers, passports or licences. Name the kind instead ([redacted password], [redacted secret], [payment card], [bank account], [tax file number], [medicare number], [ird number], [nhi number], [id number]) — never silently omit what happened. Names, companies and email addresses are fine to record.\n'
  prompt +=
    '- Match verb intensity to evidence: browsing/reviewing (no visible edits) -> "browsed," "reviewed," "checked." Light editing (small visible changes) -> "tweaked," "adjusted." Active work (sustained edits, new code, debugging) -> "implemented," "debugged," "refactored." Evidence of editing = visible changed lines, new code, or diff markers.\n'
  prompt +=
    '- Do NOT exaggerate. Switching files/tabs = browsing, not editing. Opening a file/page = reviewing, not working on it.\n'
  if (isPassiveView(activity)) {
    prompt +=
      '- The user did not click, type, or scroll in this window. Describe what was on screen and what changed on its own. NEVER imply edits, authorship, or actions taken.\n'
  }
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
    prompt += `- Window: ${scrubPII(activity.context.windowTitle)}\n`
  }
  if (activity.context.tld) {
    prompt += `- TLD: ${activity.context.tld}\n`
  }
  const url = pageUrl(activity.context.url)
  if (url) {
    prompt += `- URL: ${scrubPII(url)}\n`
  }
  prompt += `- Duration: ${durationStr}\n`
  prompt += `- Start: ${new Date(activity.startTimestamp).toISOString()}\n`
  prompt += `- End: ${new Date(activity.endTimestamp).toISOString()}\n`
  if (userContext) {
    prompt += `- User: ${scrubPII(userContext)}\n`
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
    items.push(`- t+${offsetSeconds}s: ${scrubPII(describeInteraction(interaction))}`)
  }

  if (interactions.length > maxItems) {
    items.push(`- ... ${interactions.length - maxItems} additional events omitted`)
  }

  return items.join('\n')
}

const KEY_WORDS: Record<KeyClass, string> = {
  type: 'typed text',
  enter: 'pressed Enter',
  delete: 'deleted',
  escape: 'pressed Escape',
  tab: 'pressed Tab',
  copy: 'copied',
  cut: 'cut',
  paste: 'pasted',
  undo: 'undid',
  save: 'saved',
  'mod+enter': 'submitted with Cmd/Ctrl+Enter',
}

const CLICK_WORDS: Record<ClickClass, string> = {
  left: 'click',
  double: 'double-click',
  right: 'right-click',
}

const MAX_RUNS = 8

export function describeInteraction(interaction: InteractionContext): string {
  switch (interaction.type) {
    case 'app_change': {
      const processName = interaction.activeWindow?.processName ?? 'unknown app'
      const title = interaction.activeWindow?.title
      const url = pageUrl(interaction.activeWindow?.url)
      const head = title
        ? `app switched to ${processName} (${title})`
        : `app switched to ${processName}`
      return url ? `${head} at ${url}` : head
    }
    case 'keyboard': {
      const runs = interaction.keySequence ?? []
      if (runs.length === 0) return 'typed text'
      const words = runs
        .slice(0, MAX_RUNS)
        .map((run) =>
          run.kind === 'type' || run.count === 1
            ? KEY_WORDS[run.kind]
            : `${KEY_WORDS[run.kind]} ×${run.count}`,
        )
      if (runs.length > MAX_RUNS) words.push('…')
      return words.join(', ')
    }
    case 'scroll': {
      return 'scrolled'
    }
    case 'click': {
      const runs = interaction.clickSequence ?? []
      if (runs.length === 0) return 'click'
      return runs
        .map((run) =>
          run.count === 1 ? CLICK_WORDS[run.kind] : `${run.count}× ${CLICK_WORDS[run.kind]}`,
        )
        .join(', ')
    }
    default:
      return interaction.type
  }
}

function pageUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
    return `${u.origin}${u.pathname === '/' ? '' : u.pathname}`
  } catch {
    return undefined
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
