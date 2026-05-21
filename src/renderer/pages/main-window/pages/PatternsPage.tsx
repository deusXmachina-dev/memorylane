import * as React from 'react'
import type { MainWindowAPI, PatternInfo } from '@types'
import { PageLayout } from '../components/shell/PageLayout'
import { PatternsSection } from '../components/PatternsSection'

interface PatternsPageProps {
  api: MainWindowAPI
  patterns: PatternInfo[] | null
  onPatternsChange: () => void
}

export function PatternsPage({
  api,
  patterns,
  onPatternsChange,
}: PatternsPageProps): React.JSX.Element {
  return (
    <PageLayout title="Patterns">
      {patterns === null ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <PatternsSection api={api} patterns={patterns} onPatternsChange={onPatternsChange} />
      )}
    </PageLayout>
  )
}
