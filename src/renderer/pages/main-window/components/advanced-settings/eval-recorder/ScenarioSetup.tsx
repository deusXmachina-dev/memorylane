import { ArrowLeftIcon, ArrowSquareOutIcon, RecordIcon } from '@phosphor-icons/react'
import { Button } from '@components/ui/button'
import { Card, CardContent } from '@components/ui/card'
import { isHandsOffStep } from '@/shared/eval-review'
import { SettingsSection } from '../SettingsSection'
import { FixtureRow } from './FixtureRow'
import { StatusLabel } from './ScenarioLibrary'
import type { Scenario } from './scenarios'

export function ScenarioSetup({
  scenario,
  recording,
  onBack,
  onOpenUrl,
  onStart,
  onOpenFixture,
  onExportFixture,
  onDeleteFixture,
}: {
  scenario: Scenario
  recording: boolean
  onBack: () => void
  onOpenUrl: (url: string) => void
  onStart: () => void
  onOpenFixture: (name: string) => void
  onExportFixture: (name: string) => void
  onDeleteFixture: (name: string) => void
}): React.JSX.Element {
  const { script } = scenario

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2.5">
          <ArrowLeftIcon /> Eval scenarios
        </Button>
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <h2 className="text-base font-medium">{script.title}</h2>
            <p className="text-sm text-muted-foreground">Tests: {script.targets.join(', ')}</p>
          </div>
          <StatusLabel scenario={scenario} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="space-y-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              1 · Get ready
            </div>
            <ul className="divide-y divide-border">
              {script.setup.map(({ text, url }, i) => (
                <li key={i} className="flex items-center gap-3 py-2 text-sm">
                  <span className="flex-1">{text}</span>
                  {url && (
                    <Button variant="outline" size="sm" onClick={() => onOpenUrl(url)}>
                      <ArrowSquareOutIcon /> Open
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              2 · What you'll do
            </div>
            <ol className="space-y-3">
              {script.steps.map((step, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="font-medium">{i + 1}</span>
                  <div>
                    <div>{step.instruction}</div>
                    <div className="text-xs text-muted-foreground">
                      ~{step.seconds}s{isHandsOffStep(step) && ' · hands off'}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              The steps stay on screen in a small window while you record.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button size="lg" onClick={onStart} disabled={recording}>
          <RecordIcon weight="fill" /> Start recording
        </Button>
      </div>

      {scenario.fixtures.length > 0 && (
        <SettingsSection title="Recordings">
          {scenario.fixtures.map((f) => (
            <FixtureRow
              key={f.name}
              fixture={f}
              onOpen={onOpenFixture}
              onExport={onExportFixture}
              onDelete={onDeleteFixture}
            />
          ))}
        </SettingsSection>
      )}
    </div>
  )
}
