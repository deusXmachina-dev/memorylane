import { Trash2, type LucideIcon } from 'lucide-react'
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
            <button
              type="button"
              onClick={onAddAll}
              disabled={allAlreadyExcluded}
              className="text-[11px] font-medium text-primary underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
            >
              Add all
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Dismiss
            </button>
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

interface LegacyEntriesBlockProps {
  title: string
  entries: string[]
  onRemove: (entry: string) => void
}

export function LegacyEntriesBlock({
  title,
  entries,
  onRemove,
}: LegacyEntriesBlockProps): React.JSX.Element | null {
  if (entries.length === 0) return null
  return (
    <div className="space-y-1 rounded-lg border border-border bg-muted/20 p-2">
      <p className="px-1 text-[11px] font-medium text-muted-foreground">
        {title} ({entries.length})
      </p>
      <ul className="space-y-0.5">
        {entries.map((entry) => (
          <li
            key={entry}
            className="flex items-center justify-between gap-2 rounded px-1 py-1 hover:bg-muted/40"
          >
            <code className="flex-1 truncate text-[11px]">{entry}</code>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => onRemove(entry)}
              aria-label={`Remove ${entry}`}
            >
              <Trash2 className="size-3" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
