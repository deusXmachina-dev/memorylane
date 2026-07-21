import * as React from 'react'
import type { ClustersView, MainWindowAPI, MiningStatus } from '@types'
import { PageLayout } from '../components/shell/PageLayout'
import { ClustersSection } from '../components/ClustersSection'

interface PatternsPageProps {
  api: MainWindowAPI
  clusters: ClustersView | null
  miningStatus: MiningStatus | null
}

export function PatternsPage({
  api,
  clusters,
  miningStatus,
}: PatternsPageProps): React.JSX.Element {
  return (
    <PageLayout
      title="Patterns"
      fillHeight
      subtitle={
        <p className="text-xs text-muted-foreground">
          Recurring tasks MemoryLane has spotted. Ranked by how often they recur.
        </p>
      }
    >
      {clusters === null ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <ClustersSection
          api={api}
          clusters={clusters.clusters}
          hiddenCount={clusters.hiddenCount}
          miningStatus={miningStatus}
        />
      )}
    </PageLayout>
  )
}
