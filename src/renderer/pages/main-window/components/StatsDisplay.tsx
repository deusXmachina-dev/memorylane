import * as React from 'react'
import { Card, CardContent } from '@components/ui/card'
import type { KeyStatus, MainWindowStats } from '@types'

interface StatsDisplayProps {
  stats: MainWindowStats | null
  keyStatus: KeyStatus | null
  isCustomEndpoint?: boolean
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

export function StatsDisplay({
  stats,
  keyStatus,
  isCustomEndpoint,
}: StatsDisplayProps): React.JSX.Element {
  if (!stats) {
    return (
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-center text-sm text-muted-foreground">
            Loading stats...
          </div>
        </CardContent>
      </Card>
    )
  }

  const isManaged = keyStatus?.source === 'managed'
  const hideCost = isManaged || isCustomEndpoint

  return (
    <Card>
      <CardContent className="py-3">
        <div className={`grid ${hideCost ? 'grid-cols-2' : 'grid-cols-3'} gap-4 text-center`}>
          <div>
            <div className="text-lg font-semibold">{formatNumber(stats.screenshotCount)}</div>
            <div className="text-xs text-muted-foreground">Screenshots</div>
          </div>
          <div>
            <div className="text-lg font-semibold">{formatBytes(stats.dbSize)}</div>
            <div className="text-xs text-muted-foreground">Storage</div>
          </div>
          {!hideCost && (
            <div>
              <div className="text-lg font-semibold">
                {stats.apiUsage ? `$${stats.apiUsage.totalCost.toFixed(2)}` : '-'}
              </div>
              <div className="text-xs text-muted-foreground">API Cost</div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
