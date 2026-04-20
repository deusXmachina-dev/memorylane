import { useMemo, useState } from 'react'
import { Plus, Search, type LucideIcon } from 'lucide-react'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { ScrollArea } from '@components/ui/scroll-area'
import {
  ExclusionRow,
  FoundBlock,
  LegacyEntriesBlock,
  type ExclusionRowItem,
} from './ExclusionSwitchList'

export type ExclusionPickerItem = ExclusionRowItem

interface ExclusionPickerProps {
  excluded: string[]
  onChange: (next: string[]) => void
  items: ExclusionPickerItem[] | null
  found?: string[]
  onDismissFound?: () => void
  legacyEntries: string[]
  legacyTitle: string
  emptyViewMode: 'all' | 'excluded-only'
  icon?: LucideIcon
  placeholder: string
  loadingLabel: string
  emptyLabel: string
}

export function ExclusionPicker({
  excluded,
  onChange,
  items,
  found,
  onDismissFound,
  legacyEntries,
  legacyTitle,
  emptyViewMode,
  icon,
  placeholder,
  loadingLabel,
  emptyLabel,
}: ExclusionPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()

  const excludedTokens = useMemo(() => new Set(excluded.map((e) => e.toLowerCase())), [excluded])

  const itemsByToken = useMemo(() => {
    const map = new Map<string, ExclusionPickerItem>()
    for (const item of items ?? []) map.set(item.matchToken, item)
    return map
  }, [items])

  const foundItems = useMemo<ExclusionPickerItem[]>(() => {
    if (!found?.length) return []
    return found.map((token) => {
      const normalized = token.toLowerCase()
      const known = itemsByToken.get(normalized)
      return { key: normalized, matchToken: normalized, label: known?.label ?? token }
    })
  }, [found, itemsByToken])

  const visibleItems = useMemo<ExclusionPickerItem[]>(() => {
    if (!items) return []
    if (normalizedQuery) {
      return items.filter(
        (i) =>
          i.label.toLowerCase().includes(normalizedQuery) || i.matchToken.includes(normalizedQuery),
      )
    }
    if (emptyViewMode === 'excluded-only') {
      return items.filter((i) => excludedTokens.has(i.matchToken))
    }
    return items
  }, [items, normalizedQuery, emptyViewMode, excludedTokens])

  const canAddCustom =
    normalizedQuery.length > 0 &&
    !excludedTokens.has(normalizedQuery) &&
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

  const removeLegacy = (entry: string): void => {
    onChange(excluded.filter((e) => e.toLowerCase() !== entry.toLowerCase()))
  }

  const addCustom = (): void => {
    if (!canAddCustom) return
    onChange([...excluded, normalizedQuery])
    setQuery('')
  }

  return (
    <div className="flex flex-col gap-2">
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
          className="pl-7 text-xs"
        />
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

      <LegacyEntriesBlock title={legacyTitle} entries={legacyEntries} onRemove={removeLegacy} />
    </div>
  )
}
