import * as React from 'react'
import { Button } from '@components/ui/button'
import { Card } from '@components/ui/card'
import type { ActivityDigest } from '@types'
import { formatShortDate } from './format'

interface DigestProps {
  digest: ActivityDigest | null
  loading: boolean
  onOpenPrivacy?: () => void
}

function spanDays(oldest: number | null, newest: number | null): number | null {
  if (oldest === null || newest === null) return null
  const ms = newest - oldest
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

export function Digest({ digest, loading, onOpenPrivacy }: DigestProps): React.JSX.Element {
  return (
    <Card size="sm" className="px-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">What MemoryLane has recorded</div>
          <div className="text-xs text-muted-foreground mt-1">
            {loading || !digest ? (
              <>Loading…</>
            ) : digest.totalCount === 0 ? (
              <>No captures yet. Start capture to begin recording.</>
            ) : (
              <>
                <span className="font-mono tabular-nums">{digest.totalCount.toLocaleString()}</span>{' '}
                captures
                {spanDays(digest.dateRange.oldest, digest.dateRange.newest) !== null && (
                  <>
                    {' '}
                    over{' '}
                    <span className="font-mono tabular-nums">
                      {spanDays(digest.dateRange.oldest, digest.dateRange.newest)}
                    </span>{' '}
                    days
                  </>
                )}
                {digest.dateRange.oldest !== null && (
                  <> · earliest {formatShortDate(digest.dateRange.oldest)}</>
                )}
              </>
            )}
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
          />
          <DigestList
            label="Top sites captured"
            rows={digest.topTlds.map((t) => ({ key: t.tld, label: t.tld, count: t.count }))}
            emptyHint="No web activity recorded yet."
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
}

function DigestList({ label, rows, emptyHint }: DigestListProps): React.JSX.Element {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1.5">{label}</div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground/80">{emptyHint}</div>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((r) => (
            <li
              key={r.key}
              className="flex items-baseline justify-between text-xs gap-2 leading-snug"
            >
              <span className="truncate">{r.label}</span>
              <span className="font-mono tabular-nums text-muted-foreground shrink-0">
                {r.count.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
