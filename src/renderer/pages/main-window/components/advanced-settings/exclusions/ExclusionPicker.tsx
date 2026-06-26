import { useMemo, useState } from 'react'
import { HelpCircle, Plus, Search, type LucideIcon } from 'lucide-react'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { ScrollArea } from '@components/ui/scroll-area'
import { ExclusionRow, FoundBlock, ManagedRow, type ExclusionRowItem } from './ExclusionSwitchList'

export type ExclusionPickerItem = ExclusionRowItem

const MAX_SUGGESTIONS = 8

interface ExclusionPickerProps {
  excluded: string[]
  onChange: (next: string[]) => void
  items: ExclusionPickerItem[] | null
  found?: string[]
  onDismissFound?: () => void
  /** Column heading, e.g. "Apps" / "Websites". */
  title: string
  /** Optional tooltip shown via a help icon next to the heading. */
  titleHelp?: React.ReactNode
  /** Leading icon for each rule row. */
  icon?: LucideIcon
  /** Search input placeholder. */
  placeholder: string
  /** Empty-state lines shown when nothing is blocked. */
  emptyPrimary: string
  emptySecondary: string
  /** Org-provided (centrally-synced) entries — shown read-only and filtered out
   * of the editable list. */
  managed?: string[]
}

export function ExclusionPicker({
  excluded,
  onChange,
  items,
  found,
  onDismissFound,
  title,
  titleHelp,
  icon: Icon,
  placeholder,
  emptyPrimary,
  emptySecondary,
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
  // render as read-only rows).
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

  // Rows already blocked by the user (managed entries render separately above).
  const userItems = useMemo<ExclusionPickerItem[]>(() => {
    const seen = new Set<string>()
    const rows: ExclusionPickerItem[] = []
    for (const e of excluded) {
      const token = e.toLowerCase()
      if (managedTokens.has(token) || seen.has(token)) continue
      seen.add(token)
      rows.push(itemsByToken.get(token) ?? { key: token, matchToken: token, label: e })
    }
    return rows
  }, [excluded, itemsByToken, managedTokens])

  // Search results = pool entries matching the query that aren't already blocked.
  const suggestions = useMemo<ExclusionPickerItem[]>(() => {
    if (!normalizedQuery) return []
    return editableItems
      .filter(
        (i) =>
          !excludedTokens.has(i.matchToken) &&
          (i.label.toLowerCase().includes(normalizedQuery) ||
            i.matchToken.includes(normalizedQuery)),
      )
      .slice(0, MAX_SUGGESTIONS)
  }, [editableItems, normalizedQuery, excludedTokens])

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

  const add = (token: string): void => {
    const normalized = token.trim().toLowerCase()
    if (!normalized || excludedTokens.has(normalized) || managedTokens.has(normalized)) return
    onChange([...excluded, normalized])
    setQuery('')
  }

  const hasRows = userItems.length > 0 || (managed?.length ?? 0) > 0

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {titleHelp && (
          <span
            tabIndex={0}
            role="button"
            aria-label={`How ${title} matching works`}
            className="group relative inline-flex rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <HelpCircle aria-hidden="true" className="size-3.5 cursor-help text-muted-foreground" />
            <span
              role="tooltip"
              className="pointer-events-none absolute top-full left-0 z-10 mt-1 w-64 rounded-md border border-border bg-popover px-2.5 py-2 text-[11px] leading-snug text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            >
              {titleHelp}
            </span>
          </span>
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            if (e.target.value.length > 0 && onDismissFound) onDismissFound()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && normalizedQuery) {
              e.preventDefault()
              add(suggestions[0]?.matchToken ?? normalizedQuery)
            } else if (e.key === 'Escape') {
              setQuery('')
            }
          }}
          placeholder={placeholder}
          className="pl-7 text-xs"
        />
      </div>

      {normalizedQuery ? (
        <ScrollArea className="h-42">
          <ul className="space-y-2 pr-2">
            {suggestions.map((item) => (
              <li
                key={item.key}
                className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1"
              >
                {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
                <span className="flex-1 truncate text-xs">{item.label}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => add(item.matchToken)}
                >
                  Add
                </Button>
              </li>
            ))}
            {canAddCustom && (
              <li className="flex h-9 items-center gap-2 rounded-lg border border-dashed border-border px-2.5 py-1">
                <Plus className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-xs">
                  Block <code className="font-medium">{normalizedQuery}</code>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => add(normalizedQuery)}
                >
                  Add
                </Button>
              </li>
            )}
            {suggestions.length === 0 && !canAddCustom && (
              <li className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                Already blocked.
              </li>
            )}
          </ul>
        </ScrollArea>
      ) : (
        <>
          <FoundBlock
            items={foundItems}
            excludedTokens={excludedTokens}
            onAdd={(token) => toggle(token, true)}
            onAddAll={addAllFound}
            onDismiss={onDismissFound}
            icon={Icon}
          />
          {items === null ? (
            <div className="flex h-42 items-center justify-center rounded-lg border border-dashed border-border px-3 text-center text-xs text-muted-foreground">
              Loading…
            </div>
          ) : hasRows ? (
            <ScrollArea className="h-42">
              <ul className="space-y-2 pr-2">
                {(managed ?? []).map((entry) => (
                  <ManagedRow key={`managed:${entry}`} entry={entry} icon={Icon} />
                ))}
                {userItems.map((item) => (
                  <ExclusionRow
                    key={item.key}
                    item={item}
                    onRemove={() => toggle(item.matchToken, false)}
                    icon={Icon}
                  />
                ))}
              </ul>
            </ScrollArea>
          ) : (
            <div className="flex h-42 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-border px-3 text-center text-xs text-muted-foreground">
              <p>{emptyPrimary}</p>
              <p>{emptySecondary}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
