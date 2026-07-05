import * as React from 'react'
import type { ClusterInfo, MainWindowAPI } from '@types'
import { PageLayout } from '../components/shell/PageLayout'
import { ClustersSection } from '../components/ClustersSection'

interface PatternsPageProps {
  api: MainWindowAPI
  clusters: ClusterInfo[] | null
}

export function PatternsPage({ api, clusters }: PatternsPageProps): React.JSX.Element {
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
        <ClustersSection api={api} clusters={clusters} />
      )}
    </PageLayout>
  )
}
