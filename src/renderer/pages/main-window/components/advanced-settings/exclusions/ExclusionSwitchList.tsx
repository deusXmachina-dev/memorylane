import { X, type LucideIcon } from 'lucide-react'
import { Button } from '@components/ui/button'

export interface ExclusionRowItem {
  key: string
  matchToken: string
  label: string
}

interface ExclusionRowProps {
  item: ExclusionRowItem
  onRemove: () => void
  icon?: LucideIcon
}

export function ExclusionRow({ item, onRemove, icon: Icon }: ExclusionRowProps): React.JSX.Element {
  return (
    <li className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1">
      {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
      <span className="flex-1 truncate text-xs">{item.label}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onRemove}
        aria-label={`Stop blocking ${item.label}`}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X />
      </Button>
    </li>
  )
}

interface ManagedRowProps {
  entry: string
  icon?: LucideIcon
}

/**
 * Read-only row for an org-provided (centrally-synced) exclusion. These are
 * enforced regardless of the user's own list and can't be removed here, so the
 * row shows a locked "Set by your organization" label instead of a remove button.
 */
export function ManagedRow({ entry, icon: Icon }: ManagedRowProps): React.JSX.Element {
  return (
    <li
      className="flex h-9 items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1"
      title="Set by your organization"
    >
      {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
      <span className="flex-1 truncate text-xs">{entry}</span>
      <span className="shrink-0 text-xs text-muted-foreground">Set by your organization</span>
    </li>
  )
}

interface FoundBlockProps {
  items: ExclusionRowItem[]
  excludedTokens: Set<string>
  onAdd: (matchToken: string) => void
  onAddAll?: () => void
  onDismiss?: () => void
  icon?: LucideIcon
}

export function FoundBlock({
  items,
  excludedTokens,
  onAdd,
  onAddAll,
  onDismiss,
  icon: Icon,
}: FoundBlockProps): React.JSX.Element | null {
  if (items.length === 0) return null
  const allAlreadyExcluded = items.every((item) => excludedTokens.has(item.matchToken))
  return (
    <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-2">
      <div className="flex items-center justify-between px-0.5">
        <p className="text-xs font-medium text-foreground">Found ({items.length})</p>
        <div className="flex items-center gap-2">
          {onAddAll && (
            <Button
              type="button"
              variant="link"
              size="xs"
              onClick={onAddAll}
              disabled={allAlreadyExcluded}
            >
              Add all
            </Button>
          )}
          {onDismiss && (
            <Button
              type="button"
              variant="link"
              size="xs"
              onClick={onDismiss}
              className="text-muted-foreground hover:text-foreground"
            >
              Dismiss
            </Button>
          )}
        </div>
      </div>
      <ul className="space-y-2">
        {items.map((item) => {
          const added = excludedTokens.has(item.matchToken)
          return (
            <li
              key={item.key}
              className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1"
            >
              {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
              <span className="flex-1 truncate text-xs">{item.label}</span>
              {added ? (
                <span className="text-xs text-muted-foreground">Added</span>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => onAdd(item.matchToken)}
                >
                  Add
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
