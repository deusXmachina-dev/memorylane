import { useState } from 'react'
import {
  CaretRightIcon,
  CheckCircleIcon,
  CircleIcon,
  RecordIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { Button } from '@components/ui/button'
import type { EvalFixtureSummary } from '@/shared/eval-review'
import { SettingsSection } from '../SettingsSection'
import { SegmentedControl } from '../SegmentedControl'
import { FixtureRow } from './FixtureRow'
import { nextScenario, scriptSeconds, type Scenario, type ScenarioStatus } from './scenarios'

type Filter = 'all' | ScenarioStatus

export function ScenarioLibrary({
  scenarios,
  freeFixtures,
  onOpenScenario,
  onOpenFixture,
  onExportFixture,
  onDeleteFixture,
  onFreeRecording,
}: {
  scenarios: Scenario[]
  freeFixtures: EvalFixtureSummary[]
  onOpenScenario: (scriptId: string) => void
  onOpenFixture: (name: string) => void
  onExportFixture: (name: string) => void
  onDeleteFixture: (name: string) => void
  onFreeRecording: () => void
}): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>('all')
  const count = (status: ScenarioStatus): number =>
    scenarios.filter((s) => s.status === status).length
  const done = count('done')
  const redo = count('redo')
  const total = scenarios.length
  const next = nextScenario(scenarios)
  const shown = filter === 'all' ? scenarios : scenarios.filter((s) => s.status === filter)

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-base font-medium">Eval scenarios</h2>
          <span className="text-sm text-muted-foreground">
            {done} of {total} recorded{redo > 0 && ` · ${redo} need a redo`}
          </span>
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="bg-primary" style={{ width: `${(done / Math.max(total, 1)) * 100}%` }} />
          <div
            className="bg-primary/40"
            style={{ width: `${(redo / Math.max(total, 1)) * 100}%` }}
          />
        </div>
      </section>

      {next && (
        <div className="flex items-center gap-4 rounded-xl p-4 ring-1 ring-primary">
          <RecordIcon weight="fill" className="size-6 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">Up next</div>
            <div className="font-medium">{next.script.title}</div>
            <div className="text-xs text-muted-foreground">
              {next.script.steps.length} steps · ~{scriptSeconds(next.script)}s
            </div>
          </div>
          <Button onClick={() => onOpenScenario(next.script.id)}>Record</Button>
        </div>
      )}

      <section className="space-y-3">
        <SegmentedControl
          layout="wrap"
          ariaLabel="Filter scenarios"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All ${total}` },
            { value: 'todo', label: `To record ${count('todo')}` },
            { value: 'redo', label: `Redo ${redo}` },
            { value: 'done', label: `Done ${done}` },
          ]}
        />
        <div className="divide-y divide-border rounded-xl ring-1 ring-foreground/10">
          {shown.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Nothing here.</p>
          ) : (
            shown.map((scenario) => (
              <button
                key={scenario.script.id}
                type="button"
                onClick={() => onOpenScenario(scenario.script.id)}
                className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{scenario.script.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {scenario.script.steps.length} steps · ~{scriptSeconds(scenario.script)}s ·{' '}
                    {scenario.script.targets.join(', ')}
                  </div>
                </div>
                <StatusLabel scenario={scenario} />
                <CaretRightIcon className="size-4 text-muted-foreground" />
              </button>
            ))
          )}
        </div>
      </section>

      <SettingsSection title="Other recordings" description="Recordings made without a script.">
        {freeFixtures.map((f) => (
          <FixtureRow
            key={f.name}
            fixture={f}
            onOpen={onOpenFixture}
            onExport={onExportFixture}
            onDelete={onDeleteFixture}
          />
        ))}
        <div className="py-3">
          <Button variant="outline" size="sm" onClick={onFreeRecording}>
            <RecordIcon weight="fill" /> Record without a script
          </Button>
        </div>
      </SettingsSection>
    </div>
  )
}

export function StatusLabel({ scenario }: { scenario: Scenario }): React.JSX.Element {
  if (scenario.status === 'done') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs">
        <CheckCircleIcon className="size-4 text-primary" />
        Recorded{scenario.recorded > 1 && ` ×${scenario.recorded}`}
      </span>
    )
  }
  if (scenario.status === 'redo') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs font-medium">
        <WarningCircleIcon className="size-4 text-destructive" />
        Redo
      </span>
    )
  }
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
      <CircleIcon className="size-4" />
      Not recorded
    </span>
  )
}
