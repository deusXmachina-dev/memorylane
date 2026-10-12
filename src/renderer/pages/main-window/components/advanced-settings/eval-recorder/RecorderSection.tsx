import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import type { MainWindowAPI } from '@types'
import type { EvalFixtureSummary, EvalRecordingStatus, RecordingScript } from '@/shared/eval-review'
import { formatClock } from '@/renderer/lib/recording-steps'
import { FixtureReview } from './FixtureReview'
import { ScenarioLibrary } from './ScenarioLibrary'
import { ScenarioSetup } from './ScenarioSetup'
import { buildScenarios, nextScenario } from './scenarios'

type View =
  | { kind: 'library' }
  | { kind: 'setup'; scriptId: string }
  | { kind: 'review'; name: string }

export function RecorderSection({ api }: { api: MainWindowAPI }): React.JSX.Element {
  const [view, setView] = useState<View>({ kind: 'library' })
  const [scripts, setScripts] = useState<RecordingScript[]>([])
  const [fixtures, setFixtures] = useState<EvalFixtureSummary[]>([])
  const [status, setStatus] = useState<EvalRecordingStatus | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const lastName = useRef<string | null>(null)

  const refreshFixtures = useCallback(async () => {
    setFixtures(await api.evalListFixtures())
  }, [api])

  useEffect(() => {
    void api.evalListScripts().then(setScripts)
    void refreshFixtures()
  }, [api, refreshFixtures])

  useEffect(() => {
    const poll = async (): Promise<void> => {
      const next = await api.evalRecordingStatus()
      setNow(Date.now())
      setStatus(next)
      if (next.recording) {
        lastName.current = next.name
        return
      }
      const finished = lastName.current
      if (!finished) return
      lastName.current = null
      const list = await api.evalListFixtures()
      setFixtures(list)
      if (list.some((f) => f.name === finished)) setView({ kind: 'review', name: finished })
    }
    void poll()
    const id = setInterval(() => void poll(), 1000)
    return () => clearInterval(id)
  }, [api])

  const scenarios = buildScenarios(scripts, fixtures)
  const recording = status?.recording ?? false

  const start = useCallback(
    async (scriptId?: string) => {
      const result = await api.evalStartRecording(scriptId)
      if (!result.success) {
        toast.error(result.error ?? 'Failed to start recording')
        return
      }
      lastName.current = result.status?.name ?? null
      setStatus(result.status ?? null)
    },
    [api],
  )

  const openUrl = useCallback(
    async (url: string) => {
      const result = await api.evalOpenSetupUrl(url)
      if (!result.success) toast.error(result.error ?? 'Failed to open')
    },
    [api],
  )

  const exportFixture = useCallback(
    async (name: string) => {
      const result = await api.evalExportFixture(name)
      if (!result.success) {
        if (result.error !== 'Canceled') toast.error(result.error ?? 'Export failed')
        return
      }
      toast.success('Recording exported')
    },
    [api],
  )

  const deleteFixture = useCallback(
    async (name: string) => {
      const result = await api.evalDeleteFixture(name)
      if (!result.success) toast.error(result.error ?? 'Delete failed')
      await refreshFixtures()
    },
    [api, refreshFixtures],
  )

  const banner = recording && status && (
    <div className="mb-4 flex items-center gap-3 rounded-xl p-3 text-sm ring-1 ring-destructive/40">
      <span className="size-2 rounded-full bg-destructive" />
      <span className="flex-1">
        Recording {status.scriptId && scripts.find((s) => s.id === status.scriptId)?.title}{' '}
        <span className="tabular-nums text-muted-foreground">
          {status.startedAt ? formatClock(now - status.startedAt) : ''}
        </span>
      </span>
      <Button variant="ghost" size="sm" onClick={() => void api.evalCancelRecording()}>
        Cancel
      </Button>
      <Button size="sm" onClick={() => void api.evalStopRecording()}>
        Done
      </Button>
    </div>
  )

  if (view.kind === 'review') {
    const fixture = fixtures.find((f) => f.name === view.name)
    const script = scripts.find((s) => s.id === fixture?.scriptId) ?? null
    const next = nextScenario(scenarios, script?.id)
    return (
      <>
        {banner}
        <FixtureReview
          key={view.name}
          api={api}
          name={view.name}
          script={script}
          hasNext={next !== null}
          onBack={() => {
            void refreshFixtures()
            setView({ kind: 'library' })
          }}
          onRerecord={(scriptId) => setView({ kind: 'setup', scriptId })}
          onNext={() => {
            void refreshFixtures()
            setView(next ? { kind: 'setup', scriptId: next.script.id } : { kind: 'library' })
          }}
          onExport={(name) => void exportFixture(name)}
          onDeleted={() => {
            void refreshFixtures()
            setView(script ? { kind: 'setup', scriptId: script.id } : { kind: 'library' })
          }}
        />
      </>
    )
  }

  if (view.kind === 'setup') {
    const scenario = scenarios.find((s) => s.script.id === view.scriptId)
    if (scenario) {
      return (
        <>
          {banner}
          <ScenarioSetup
            scenario={scenario}
            recording={recording}
            onBack={() => setView({ kind: 'library' })}
            onOpenUrl={(url) => void openUrl(url)}
            onStart={() => void start(scenario.script.id)}
            onOpenFixture={(name) => setView({ kind: 'review', name })}
            onExportFixture={(name) => void exportFixture(name)}
            onDeleteFixture={(name) => void deleteFixture(name)}
          />
        </>
      )
    }
  }

  return (
    <>
      {banner}
      <ScenarioLibrary
        scenarios={scenarios}
        freeFixtures={fixtures.filter((f) => f.scriptId === null)}
        onOpenScenario={(scriptId) => setView({ kind: 'setup', scriptId })}
        onOpenFixture={(name) => setView({ kind: 'review', name })}
        onExportFixture={(name) => void exportFixture(name)}
        onDeleteFixture={(name) => void deleteFixture(name)}
        onFreeRecording={() => void start()}
      />
    </>
  )
}
