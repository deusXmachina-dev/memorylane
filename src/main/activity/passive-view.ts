import type { Activity } from './activity-types'

/**
 * A view with no clicks, keystrokes, or scrolls — only app focus, presence
 * heartbeats, or nothing. Defined as the absence of active-engagement events
 * so synthetic 'presence' keep-alives don't push a read onto the LLM path.
 */
export function isPassiveView(activity: Activity): boolean {
  return !activity.interactions.some(
    (interaction) =>
      interaction.type === 'click' ||
      interaction.type === 'keyboard' ||
      interaction.type === 'scroll',
  )
}
