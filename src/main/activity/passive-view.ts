import type { Activity } from './activity-types'

/**
 * A view with no clicks, keystrokes, or scrolls — only app focus or nothing.
 */
export function isPassiveView(activity: Activity): boolean {
  return !activity.interactions.some(
    (interaction) =>
      interaction.type === 'click' ||
      interaction.type === 'keyboard' ||
      interaction.type === 'scroll',
  )
}
