import * as React from 'react'
import { Button } from '@components/ui/button'
import { Card } from '@components/ui/card'
import type { ActivityDigest } from '@types'
import { formatShortDate } from './format'

interface DigestProps {
  digest: ActivityDigest | null
  loading: boolean
  onOpenPrivacy?: () => void
  onSelectApp?: (app: string | null) => void
  onSelectTld?: (tld: string | null) => void
  activeApp?: string | null
  activeTld?: string | null
}

function spanDays(oldest: number | null, newest: number | null): number | null {
  if (oldest === null || newest === null) return null
  const ms = newest - oldest
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

function DigestHeadline({
  digest,
  loading,
}: {
  digest: ActivityDigest | null
  loading: boolean
}): React.JSX.Element {
  if (!digest) return <>{loading ? 'Loading…' : 'No data yet.'}</>
  if (digest.totalCount === 0) return <>No captures yet. Start capture to begin recording.</>
  const span = spanDays(digest.dateRange.oldest, digest.dateRange.newest)
  return (
    <>
      <span className="font-mono tabular-nums">{digest.totalCount.toLocaleString()}</span> captures
      {span !== null && (
        <>
          {' '}
          over <span className="font-mono tabular-nums">{span}</span> days
        </>
      )}
      {digest.dateRange.oldest !== null && (
        <> · earliest {formatShortDate(digest.dateRange.oldest)}</>
      )}
    </>
  )
}

export function Digest({
  digest,
  loading,
  onOpenPrivacy,
  onSelectApp,
  onSelectTld,
  activeApp,
  activeTld,
}: DigestProps): React.JSX.Element {
  return (
    <Card size="sm" className="px-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">What MemoryLane has recorded</div>
          <div className="text-xs text-muted-foreground mt-1">
            <DigestHeadline digest={digest} loading={loading} />
          </div>
        </div>
        {onOpenPrivacy && (
          <Button variant="outline" size="sm" onClick={onOpenPrivacy}>
            Manage in Privacy →
          </Button>
        )}
      </div>

      {digest && digest.totalCount > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
          <DigestList
            label="Top apps captured"
            rows={digest.topApps.map((a) => ({ key: a.appName, label: a.appName, count: a.count }))}
            emptyHint="No apps recorded yet."
            activeKey={activeApp ?? null}
            onSelect={onSelectApp}
          />
          <DigestList
            label="Top sites captured"
            rows={digest.topTlds.map((t) => ({ key: t.tld, label: t.tld, count: t.count }))}
            emptyHint="No web activity recorded yet."
            activeKey={activeTld ?? null}
            onSelect={onSelectTld}
          />
        </div>
      )}
    </Card>
  )
}

interface DigestListProps {
  label: string
  rows: { key: string; label: string; count: number }[]
  emptyHint: string
  activeKey?: string | null
  onSelect?: (key: string | null) => void
}

function DigestList({
  label,
  rows,
  emptyHint,
  activeKey,
  onSelect,
}: DigestListProps): React.JSX.Element {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1.5 flex items-baseline justify-between gap-2">
        <span>{label}</span>
        {onSelect && rows.length > 0 && (
          <span className="text-[10px] text-muted-foreground/70">Click to filter</span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground/80">{emptyHint}</div>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((r) => {
            const isActive = activeKey === r.key
            const content = (
              <>
                <span className="truncate">{r.label}</span>
                <span className="font-mono tabular-nums text-muted-foreground shrink-0">
                  {r.count.toLocaleString()}
                </span>
              </>
            )
            if (!onSelect) {
              return (
                <li
                  key={r.key}
                  className="flex items-baseline justify-between text-xs gap-2 leading-snug"
                >
                  {content}
                </li>
              )
            }
            return (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={() => onSelect(isActive ? null : r.key)}
                  className={`w-full flex items-baseline justify-between text-xs gap-2 leading-snug rounded px-1 -mx-1 py-0.5 text-left hover:bg-muted/60 ${
                    isActive ? 'bg-muted ring-1 ring-foreground/10' : ''
                  }`}
                  aria-pressed={isActive}
                >
                  {content}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
