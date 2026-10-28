import type { InteractionContext } from '@/shared/types'

type ActiveWindow = NonNullable<InteractionContext['activeWindow']>

const TYPED_TITLE_APPS = new Set(['notepad'])

export function isTypedTitleEdit(prev: ActiveWindow, next: ActiveWindow): boolean {
  if (!TYPED_TITLE_APPS.has(next.processName.toLowerCase())) return false
  if (!next.windowId || prev.windowId !== next.windowId) return false
  if (prev.processName !== next.processName) return false
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
