import * as React from 'react'
import type { ClustersView, MainWindowAPI, PatternInfo } from '@types'
import { PageLayout } from '../components/shell/PageLayout'
import { ClustersSection } from '../components/ClustersSection'
import { PatternsSection } from '../components/PatternsSection'

interface PatternsPageProps {
  api: MainWindowAPI
  /** Developer toggle (read at startup): true → new clusters view, false → legacy patterns view. */
  newTaskMinerEnabled: boolean
  clusters: ClustersView | null
  patterns: PatternInfo[] | null
  onPatternsChange: () => void
}

export function PatternsPage({
  api,
  newTaskMinerEnabled,
  clusters,
  patterns,
  onPatternsChange,
}: PatternsPageProps): React.JSX.Element {
  const subtitle = newTaskMinerEnabled
    ? 'Recurring tasks MemoryLane has spotted. Ranked by how often they recur.'
    : 'Repetitive workflows MemoryLane has spotted. Ranked by likely impact.'

  const loading = newTaskMinerEnabled ? clusters === null : patterns === null

  return (
    <PageLayout
      title="Patterns"
      fillHeight
      subtitle={<p className="text-xs text-muted-foreground">{subtitle}</p>}
    >
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : newTaskMinerEnabled ? (
        <ClustersSection
          api={api}
          clusters={clusters!.clusters}
          hiddenCount={clusters!.hiddenCount}
        />
      ) : (
        <PatternsSection api={api} patterns={patterns!} onPatternsChange={onPatternsChange} />
      )}
    </PageLayout>
  )
}
