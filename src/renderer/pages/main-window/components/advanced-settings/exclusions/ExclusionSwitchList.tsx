import { Lock, type LucideIcon } from 'lucide-react'
import { Button } from '@components/ui/button'
import { Switch } from '@components/ui/switch'

export interface ExclusionRowItem {
  key: string
  matchToken: string
  label: string
}

interface ExclusionRowProps {
  item: ExclusionRowItem
  checked: boolean
  onToggle: (checked: boolean) => void
  icon?: LucideIcon
}

export function ExclusionRow({
  item,
  checked,
  onToggle,
  icon: Icon,
}: ExclusionRowProps): React.JSX.Element {
  return (
    <li className="flex items-center gap-2 px-2 py-1.5">
      {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
      <span className="flex-1 truncate text-xs">{item.label}</span>
      <Switch checked={checked} onCheckedChange={onToggle} aria-label={`Exclude ${item.label}`} />
    </li>
  )
}

interface ManagedBlockProps {
  entries: string[]
  icon?: LucideIcon
}

/**
 * Read-only block listing the org-provided (centrally-synced) exclusions. These
 * are enforced regardless of the user's own list and can't be turned off here,
 * so each row shows a locked, always-on toggle.
 */
export function ManagedBlock({ entries, icon: Icon }: ManagedBlockProps): React.JSX.Element | null {
  if (entries.length === 0) return null
  return (
    <div className="space-y-1 rounded-lg border border-border bg-muted/20 p-2">
      <div className="flex items-center gap-1.5 px-1">
        <Lock aria-hidden="true" className="size-3 text-muted-foreground" />
        <p className="text-[11px] font-medium text-muted-foreground">
          Set by your organization ({entries.length})
        </p>
      </div>
      <ul className="divide-y divide-border/60">
        {entries.map((entry) => (
          <li key={entry} className="flex items-center gap-2 px-1 py-1.5">
            {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
            <span className="flex-1 truncate text-xs">{entry}</span>
            <Switch checked disabled aria-label={`${entry} — set by your organization`} />
          </li>
        ))}
      </ul>
    </div>
  )
}

interface FoundBlockProps {
  items: ExclusionRowItem[]
  excludedTokens: Set<string>
  onToggle: (matchToken: string, checked: boolean) => void
  onAddAll?: () => void
  onDismiss?: () => void
  icon?: LucideIcon
}

export function FoundBlock({
  items,
  excludedTokens,
  onToggle,
  onAddAll,
  onDismiss,
  icon,
}: FoundBlockProps): React.JSX.Element | null {
  if (items.length === 0) return null
  const allAlreadyExcluded = items.every((item) => excludedTokens.has(item.matchToken))
  return (
    <div className="space-y-1 rounded-lg border border-primary/40 bg-primary/5 p-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-[11px] font-medium text-foreground">Found ({items.length})</p>
        <div className="flex items-center gap-3">
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
      <ul className="divide-y divide-border/60">
        {items.map((item) => (
          <ExclusionRow
            key={item.key}
            item={item}
            checked={excludedTokens.has(item.matchToken)}
            onToggle={(checked) => onToggle(item.matchToken, checked)}
            icon={icon}
          />
        ))}
      </ul>
    </div>
  )
}
