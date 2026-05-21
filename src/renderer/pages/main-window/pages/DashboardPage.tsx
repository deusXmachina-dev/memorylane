import * as React from 'react'
import { Card, CardContent } from '@components/ui/card'
import type { KeyStatus, LlmHealthStatus, MainWindowStats } from '@types'
import { PageLayout } from '../components/shell/PageLayout'
import { StatusLine } from '../components/StatusLine'
import { StatsDisplay } from '../components/StatsDisplay'

interface DashboardPageProps {
  capturing: boolean
  llmHealth: LlmHealthStatus | null
  stats: MainWindowStats | null
  keyStatus: KeyStatus | null
  isCustomEndpoint: boolean
}

function formatRelative(timestamp: number | null): string {
  if (timestamp === null) return 'No activity yet'
  const diff = Date.now() - timestamp
  if (diff < 60_000) return 'Just now'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return `${days} d ago`
}

export function DashboardPage({
  capturing,
  llmHealth,
  stats,
  keyStatus,
  isCustomEndpoint,
}: DashboardPageProps): React.JSX.Element {
  const lastSeen = stats?.dateRange.newest ?? null
  const repetitiveHours = stats?.totalRepetitiveHoursPerWeek ?? null

  return (
    <PageLayout
      title="Dashboard"
      subtitle={
        <StatusLine
          capturing={capturing}
          llmHealth={llmHealth}
          activityCount={stats?.activityCount ?? null}
        />
      }
    >
      <StatsDisplay stats={stats} keyStatus={keyStatus} isCustomEndpoint={isCustomEndpoint} />

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-muted-foreground">Last activity</div>
            <div className="text-sm font-medium mt-1">{formatRelative(lastSeen)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-muted-foreground">Repetitive work / week</div>
            <div className="text-sm font-medium mt-1">
              {repetitiveHours === null ? '—' : `~${repetitiveHours} h`}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  )
}
