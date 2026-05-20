import * as React from 'react'
import type { MainWindowAPI, PatternInfo } from '@types'
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
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Patterns</h1>
      {patterns === null ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <PatternsSection api={api} patterns={patterns} onPatternsChange={onPatternsChange} />
      )}
    </div>
  )
}
