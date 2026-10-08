import type { ClickClass, InputRun, InteractionContext, KeyClass } from '../../shared/types'
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
  prompt +=
    '- Media is the primary source for what was on screen. The timeline records what the user actually did (typing, submit keys, scrolling, clicks): use it to tell what the user did from what they merely saw. Long timelines omit some events; the Input totals line still counts everything.\n'
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
    '- Distinguish preparation from completion. A form, dialog, or compose window being filled out is NOT by itself evidence it was submitted. Treat it as completed when there is visible confirmation (success toast, redirect, confirmation screen, message appearing in the thread) OR the timeline shows a submit key right after typing (Enter, Cmd/Ctrl+Enter, Cmd/Ctrl+S) and the content then left the input or the view changed. Otherwise use preparatory verbs like "started," "drafted," "filled out" — NOT completion verbs like "sent," "submitted," "invited," "created."\n'
  prompt +=
    '- Typing in documents, code editors, issue trackers, wikis, and spreadsheets changes the content directly: describe it as "edited," "updated," or "wrote," not "drafted."\n'
  prompt +=
    '- If the timeline shows no typing, the user did not write or edit any text: use reading verbs ("read," "reviewed," "browsed") even if content on screen changed. Claim click-driven actions (approved, deleted, toggled) only when the result is visible.\n'
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
    'Describe what was worked on. Start mid-sentence with the action (e.g. "Implemented...", "Reviewed...", "Read...", "Sent...").\n'

  return prompt
}

const MAX_TIMELINE_LINES = 20

interface TimelineLine {
  offsetSeconds: number
  text: string
  keep: boolean
}

function buildInteractionTimeline(activity: Activity): string {
  // Presence heartbeats are synthetic keep-alives with no user-action signal, so
  // they're excluded from the timeline the model reasons over.
  const interactions = activity.interactions
    .filter((interaction) => interaction.type !== 'presence')
    .sort((a, b) => a.timestamp - b.timestamp)
  if (interactions.length === 0) {
    return '- No interaction events captured.'
  }

  const lines = groupInteractions(interactions).map((group): TimelineLine => {
    const merged = mergeGroup(group)
    return {
      offsetSeconds: (group[0].timestamp - activity.startTimestamp) / 1000,
      text: scrubPII(describeInteraction(merged)),
      keep: hasSignificantInput(merged),
    }
  })

  return [`- ${describeInputTotals(interactions)}`, ...capLines(lines)].join('\n')
}

function groupInteractions(interactions: InteractionContext[]): InteractionContext[][] {
  const groups: InteractionContext[][] = []
  for (const interaction of interactions) {
    const current = groups[groups.length - 1]
    if (current && interaction.type !== 'app_change' && current[0].type === interaction.type) {
      current.push(interaction)
    } else {
      groups.push([interaction])
    }
  }
  return groups
}

function mergeGroup(group: InteractionContext[]): InteractionContext {
  if (group.length === 1) return group[0]
  const first = group[0]
  switch (first.type) {
    case 'keyboard':
      return {
        ...first,
        keyCount: sum(group, (event) => event.keyCount ?? 0),
        keySequence: mergeRuns(group.map(keySequenceOf)),
      }
    case 'scroll':
      return { ...first, durationMs: sum(group, (event) => event.durationMs ?? 0) }
    case 'click':
      return { ...first, clickSequence: mergeRuns(group.map(clickSequenceOf)) }
    default:
      return first
  }
}

function mergeRuns<T extends string>(sequences: InputRun<T>[][]): InputRun<T>[] {
  const merged: InputRun<T>[] = []
  for (const run of sequences.flat()) {
    const last = merged[merged.length - 1]
    if (last?.kind === run.kind) last.count += run.count
    else if (run.count > 0) merged.push({ ...run })
  }
  return merged
}

function keySequenceOf(event: InteractionContext): InputRun<KeyClass>[] {
  return event.keySequence ?? [{ kind: 'char', count: event.keyCount ?? 0 }]
}

function clickSequenceOf(event: InteractionContext): InputRun<ClickClass>[] {
  return event.clickSequence ?? [{ kind: 'left', count: 1 }]
}

function capLines(lines: TimelineLine[]): string[] {
  const indices = lines.map((_, index) => index)
  const significant = indices.filter((index) => lines[index].keep)
  const others = indices.filter((index) => !lines[index].keep)
  const kept = new Set(pickEnds(significant, MAX_TIMELINE_LINES))
  pickEnds(others, MAX_TIMELINE_LINES - kept.size).forEach((index) => kept.add(index))

  const output: string[] = []
  let omitted = 0
  lines.forEach((line, index) => {
    if (!kept.has(index)) {
      omitted++
      return
    }
    if (omitted > 0) {
      output.push(`- ... ${omitted} events omitted`)
      omitted = 0
    }
    output.push(`- t+${line.offsetSeconds.toFixed(1)}s: ${line.text}`)
  })
  if (omitted > 0) output.push(`- ... ${omitted} events omitted`)
  return output
}

function pickEnds(indices: number[], budget: number): number[] {
  if (indices.length <= budget) return indices
  const head = Math.ceil(budget / 2)
  return [...indices.slice(0, head), ...indices.slice(indices.length - (budget - head))]
}

function describeInputTotals(interactions: InteractionContext[]): string {
  const keyboard = interactions.filter((interaction) => interaction.type === 'keyboard')
  const characters = sum(keyboard.map(keySequenceOf).flat(), (run) =>
    run.kind === 'char' ? run.count : 0,
  )
  const scrolls = interactions.filter((interaction) => interaction.type === 'scroll').length
  const clickRuns = interactions
    .filter((interaction) => interaction.type === 'click')
    .flatMap(clickSequenceOf)
  const clicks = sum(clickRuns, (run) => (run.kind === 'drag' ? 0 : run.count))
  const drags = sum(clickRuns, (run) => (run.kind === 'drag' ? run.count : 0))
  const totals = [
    `${plural(characters, 'character')} typed`,
    plural(scrolls, 'scroll burst'),
    plural(clicks, 'click'),
    ...(drags > 0 ? [plural(drags, 'drag')] : []),
  ]
  return `Input totals: ${totals.join(', ')}`
}

function hasSignificantInput(interaction: InteractionContext): boolean {
  return (
    (interaction.keySequence?.some((run) => run.kind !== 'char' && run.kind !== 'delete') ??
      false) ||
    (interaction.clickSequence?.some((run) => run.kind !== 'left') ?? false)
  )
}

const KEY_PHRASES: Record<Exclude<KeyClass, 'char' | 'delete'>, string> = {
  enter: 'pressed Enter',
  'shift+enter': 'pressed Shift+Enter (new line)',
  tab: 'pressed Tab',
  escape: 'pressed Escape',
  'mod+enter': 'pressed Cmd/Ctrl+Enter (send/submit)',
  'mod+s': 'pressed Cmd/Ctrl+S (save)',
  'mod+c': 'pressed Cmd/Ctrl+C (copy)',
  'mod+v': 'pressed Cmd/Ctrl+V (paste)',
  'mod+x': 'pressed Cmd/Ctrl+X (cut)',
  'mod+z': 'pressed Cmd/Ctrl+Z (undo)',
  'mod+a': 'pressed Cmd/Ctrl+A (select all)',
  'mod+f': 'pressed Cmd/Ctrl+F (find)',
  shortcut: 'used a keyboard shortcut',
}

const CLICK_PHRASES: Record<ClickClass, string> = {
  left: 'clicked',
  right: 'right-clicked (context menu)',
  middle: 'middle-clicked (open in new tab)',
  double: 'double-clicked (open/select)',
  mod: 'Cmd/Ctrl-clicked (open in new tab/multi-select)',
  drag: 'dragged (move/select)',
}

function describeKeyRun(run: InputRun<KeyClass>): string {
  if (run.kind === 'char') return `typed ${plural(run.count, 'character')}`
  if (run.kind === 'delete') return `deleted ${plural(run.count, 'character')}`
  return withCount(KEY_PHRASES[run.kind], run.count)
}

function describeClickRun(run: InputRun<ClickClass>): string {
  return withCount(CLICK_PHRASES[run.kind], run.count)
}

function withCount(phrase: string, count: number): string {
  return count > 1 ? `${phrase} ×${count}` : phrase
}

export function describeInteraction(interaction: InteractionContext): string {
  switch (interaction.type) {
    case 'app_change': {
      const processName = interaction.activeWindow?.processName ?? 'unknown app'
      const title = interaction.activeWindow?.title
      return title ? `app switched to ${processName} (${title})` : `app switched to ${processName}`
    }
    case 'keyboard': {
      if (interaction.keySequence && interaction.keySequence.length > 0) {
        return interaction.keySequence.map(describeKeyRun).join(', then ')
      }
      if (interaction.keySequence) return 'used navigation keys'
      const keyCount = interaction.keyCount ?? 0
      return keyCount > 0 ? `typed ${plural(keyCount, 'key')}` : 'typed'
    }
    case 'scroll': {
      const seconds = Math.round((interaction.durationMs ?? 0) / 1000)
      return seconds > 0 ? `scrolled for ${seconds}s` : 'scrolled'
    }
    case 'click':
      return clickSequenceOf(interaction).map(describeClickRun).join(', then ') || 'clicked'
    default:
      return interaction.type
  }
}

function sum<T>(items: T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + value(item), 0)
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
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
