import type { InteractionContext } from '@/shared/types'

type ActiveWindow = NonNullable<InteractionContext['activeWindow']>

// Apps that title an unsaved document after the text being typed into it.
const TYPED_TITLE_APPS = new Set(['notepad'])

/** True when `next` is `prev` retitled by typing: text inserted or deleted at one spot. */
export function isTypedTitleEdit(prev: ActiveWindow, next: ActiveWindow): boolean {
  if (!TYPED_TITLE_APPS.has(next.processName.toLowerCase())) return false
  if (prev.processName !== next.processName || prev.windowId !== next.windowId) return false
  const a = prev.title
  const b = next.title
  if (!a || !b || a === b) return false
  const shorter = Math.min(a.length, b.length)
  let prefix = 0
  while (prefix < shorter && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (suffix < shorter - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) {
    suffix++
  }
  return a.length === prefix + suffix || b.length === prefix + suffix
}
