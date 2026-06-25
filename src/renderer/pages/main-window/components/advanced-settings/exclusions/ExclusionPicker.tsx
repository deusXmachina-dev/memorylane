import { useMemo, useState } from 'react'
import { Plus, Search, X, type LucideIcon } from 'lucide-react'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { ScrollArea } from '@components/ui/scroll-area'
import {
  ExclusionRow,
  FoundBlock,
  ManagedBlock,
  type ExclusionRowItem,
} from './ExclusionSwitchList'

export type ExclusionPickerItem = ExclusionRowItem

interface ExclusionPickerProps {
  excluded: string[]
  onChange: (next: string[]) => void
  items: ExclusionPickerItem[] | null
  found?: string[]
  onDismissFound?: () => void
  icon?: LucideIcon
  placeholder: string
  loadingLabel: string
  emptyLabel: string
  /** Org-provided (centrally-synced) entries — shown read-only in a locked block
   * and filtered out of the editable list. */
  managed?: string[]
}

export function ExclusionPicker({
  excluded,
  onChange,
  items,
  found,
  onDismissFound,
  icon,
  placeholder,
  loadingLabel,
  emptyLabel,
  managed,
}: ExclusionPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()

  const excludedTokens = useMemo(() => new Set(excluded.map((e) => e.toLowerCase())), [excluded])
  const managedTokens = useMemo(
    () => new Set((managed ?? []).map((m) => m.toLowerCase())),
    [managed],
  )

  // Editable pool = everything except the org-managed entries (those only ever
  // render in the locked block above).
  const editableItems = useMemo(
    () => (items ?? []).filter((i) => !managedTokens.has(i.matchToken)),
    [items, managedTokens],
  )
  const itemsByToken = useMemo(
    () => new Map(editableItems.map((i) => [i.matchToken, i])),
    [editableItems],
  )

  const foundItems = useMemo<ExclusionPickerItem[]>(() => {
    if (!found?.length) return []
    return found
      .filter((token) => !managedTokens.has(token.toLowerCase()))
      .map((token) => {
        const normalized = token.toLowerCase()
        return {
          key: normalized,
          matchToken: normalized,
          label: itemsByToken.get(normalized)?.label ?? token,
        }
      })
  }, [found, itemsByToken, managedTokens])

  const visibleItems = useMemo<ExclusionPickerItem[]>(() => {
    if (!items) return []
    if (normalizedQuery) {
      return editableItems.filter(
        (i) =>
          i.label.toLowerCase().includes(normalizedQuery) || i.matchToken.includes(normalizedQuery),
      )
    }
    return editableItems.filter((i) => excludedTokens.has(i.matchToken))
  }, [items, editableItems, normalizedQuery, excludedTokens])

  const canAddCustom =
    normalizedQuery.length > 0 &&
    !excludedTokens.has(normalizedQuery) &&
    !managedTokens.has(normalizedQuery) &&
    !itemsByToken.has(normalizedQuery)

  const toggle = (token: string, checked: boolean): void => {
    const normalized = token.toLowerCase()
    const next = excluded.filter((e) => e.toLowerCase() !== normalized)
    if (checked) next.push(normalized)
    onChange(next)
  }

  const addAllFound = (): void => {
    if (foundItems.length === 0) return
    const next = [...excluded]
    const seen = new Set(excluded.map((e) => e.toLowerCase()))
    for (const item of foundItems) {
      if (!seen.has(item.matchToken)) {
        next.push(item.matchToken)
        seen.add(item.matchToken)
      }
    }
    onChange(next)
    onDismissFound?.()
  }

  const addCustom = (): void => {
    if (!canAddCustom) return
    onChange([...excluded, normalizedQuery])
    setQuery('')
  }

  return (
    <div className="flex flex-col gap-2">
      <ManagedBlock entries={managed ?? []} icon={icon} />

      <FoundBlock
        items={foundItems}
        excludedTokens={excludedTokens}
        onToggle={toggle}
        onAddAll={addAllFound}
        onDismiss={onDismissFound}
        icon={icon}
      />

      <div className="relative">
        <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            if (e.target.value.length > 0 && onDismissFound) onDismissFound()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canAddCustom && visibleItems.length === 0) {
              e.preventDefault()
              addCustom()
            }
          }}
          placeholder={placeholder}
          className="pl-7 pr-7 text-xs"
        />
        {query.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X />
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-border">
        {items === null ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">{loadingLabel}</div>
        ) : visibleItems.length === 0 && !canAddCustom ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            {normalizedQuery ? 'Already blocked.' : emptyLabel}
          </div>
        ) : (
          <ScrollArea className="max-h-72">
            <ul className="divide-y divide-border">
              {visibleItems.map((item) => (
                <ExclusionRow
                  key={item.key}
                  item={item}
                  checked={excludedTokens.has(item.matchToken)}
                  onToggle={(checked) => toggle(item.matchToken, checked)}
                  icon={icon}
                />
              ))}
              {canAddCustom && (
                <li className="flex items-center gap-2 px-2 py-1.5">
                  <Plus className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate text-xs">
                    Add <code className="font-medium">{normalizedQuery}</code>
                  </span>
                  <Button size="xs" variant="outline" onClick={addCustom}>
                    Add
                  </Button>
                </li>
              )}
            </ul>
          </ScrollArea>
        )}
      </div>
    </div>
  )
}
