import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  RecordIcon,
  StopIcon,
  TrashIcon,
  ExportIcon,
  ArrowLeftIcon,
  FloppyDiskIcon,
} from '@phosphor-icons/react'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import { Card, CardContent } from '@components/ui/card'
import { Tabs, TabsList, TabsTab, TabsPanel } from '@components/ui/tabs'
import type { MainWindowAPI } from '@types'
import type { EvalFixtureLoad, EvalFixtureSummary } from '@/shared/eval-review'
import { setDevMode } from '@/renderer/lib/dev-mode'
import { SettingsSection } from './SettingsSection'
import { TaskGoldenSection } from './TaskGoldenSection'

export function DeveloperSection({ api }: { api: MainWindowAPI }): React.JSX.Element {
  return (
    <div className="space-y-6">
      <Tabs defaultValue="recorder">
        <TabsList>
          <TabsTab value="recorder">Recorder</TabsTab>
          <TabsTab value="tasks">Tasks</TabsTab>
        </TabsList>
        <TabsPanel value="recorder" className="pt-2">
          <RecorderSection api={api} />
        </TabsPanel>
        <TabsPanel value="tasks" className="pt-2">
          <TaskGoldenSection api={api} />
        </TabsPanel>
      </Tabs>

      <div className="pt-2">
        <Button variant="outline" size="sm" onClick={() => setDevMode(false)}>
          Disable Developer mode
        </Button>
      </div>
    </div>
  )
}

/** mm:ss elapsed from a start epoch. */
function elapsed(startedAt: number, now: number): string {
  const total = Math.max(0, Math.round((now - startedAt) / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function defaultName(): string {
  // Local time, filesystem-friendly — sanitized again in the main process.
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
}

function RecorderSection({ api }: { api: MainWindowAPI }): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [name, setName] = useState(defaultName)
  const [busy, setBusy] = useState(false)

  const [fixtures, setFixtures] = useState<EvalFixtureSummary[]>([])
  const [selected, setSelected] = useState<EvalFixtureLoad | null>(null)
  const [goldenDraft, setGoldenDraft] = useState('')
  const goldenDirty = selected !== null && goldenDraft !== selected.goldenMd

  const refreshFixtures = useCallback(async () => {
    setFixtures(await api.evalListFixtures())
  }, [api])

  // Initial state: are we already recording (e.g. after a re-render)?
  useEffect(() => {
    void (async () => {
      const status = await api.evalRecordingStatus()
      setRecording(status.recording)
      setStartedAt(status.startedAt)
      await refreshFixtures()
    })()
  }, [api, refreshFixtures])

  // Tick the elapsed clock while recording.
  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [recording])

  const startRecording = useCallback(async () => {
    setBusy(true)
    const result = await api.evalStartRecording(name)
    setBusy(false)
    if (!result.success) {
      toast.error(result.error ?? 'Failed to start recording')
      return
    }
    setRecording(true)
    setStartedAt(result.status?.startedAt ?? Date.now())
    setNow(Date.now())
    toast.success('Recording started')
  }, [api, name])

  const stopRecording = useCallback(async () => {
    setBusy(true)
    toast.loading('Promoting fixture…', { id: 'eval-stop' })
    const result = await api.evalStopRecording()
    setBusy(false)
    setRecording(false)
    setStartedAt(null)
    if (!result.success) {
      toast.error(result.error ?? 'Failed to stop recording', { id: 'eval-stop' })
      return
    }
    toast.success(
      `Fixture "${result.fixture?.name}" created (${result.fixture?.frameCount ?? 0} frames)`,
      { id: 'eval-stop' },
    )
    setName(defaultName())
    await refreshFixtures()
  }, [api, refreshFixtures])

  const openFixture = useCallback(
    async (fixtureName: string) => {
      const loaded = await api.evalLoadFixture(fixtureName)
      if (!loaded) {
        toast.error('Failed to load fixture')
        return
      }
      setSelected(loaded)
      setGoldenDraft(loaded.goldenMd)
    },
    [api],
  )

  const saveGolden = useCallback(async () => {
    if (!selected) return
    const result = await api.evalSaveGolden(selected.name, goldenDraft)
    if (!result.success) {
      toast.error(result.error ?? 'Failed to save golden')
      return
    }
    setSelected({ ...selected, goldenMd: goldenDraft })
    toast.success('Golden saved')
  }, [api, selected, goldenDraft])

  const exportFixture = useCallback(
    async (fixtureName: string) => {
      const result = await api.evalExportFixture(fixtureName)
      if (!result.success) {
        if (result.error !== 'Canceled') toast.error(result.error ?? 'Export failed')
        return
      }
      toast.success('Fixture exported')
    },
    [api],
  )

  const deleteFixture = useCallback(
    async (fixtureName: string) => {
      const result = await api.evalDeleteFixture(fixtureName)
      if (!result.success) {
        toast.error(result.error ?? 'Delete failed')
        return
      }
      if (selected?.name === fixtureName) setSelected(null)
      await refreshFixtures()
    },
    [api, selected, refreshFixtures],
  )

  if (selected) {
    return (
      <FixtureReview
        fixture={selected}
        goldenDraft={goldenDraft}
        dirty={goldenDirty}
        onGoldenChange={setGoldenDraft}
        onSave={saveGolden}
        onBack={() => setSelected(null)}
      />
    )
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Record eval session"
        description="Records a real session and turns it into an eval fixture (video + editable golden). Capture is left as you found it when you stop."
      >
        <div className="flex items-center gap-2 py-3">
          {recording ? (
            <>
              <Button variant="destructive" onClick={stopRecording} disabled={busy}>
                <StopIcon weight="fill" /> Stop
              </Button>
              <span className="text-sm text-muted-foreground tabular-nums">
                Recording… {startedAt ? elapsed(startedAt, now) : '0:00'}
              </span>
            </>
          ) : (
            <>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="fixture name"
                className="max-w-xs"
              />
              <Button onClick={startRecording} disabled={busy || !name.trim()}>
                <RecordIcon weight="fill" /> Start recording
              </Button>
            </>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Fixtures"
        description="Open a fixture to review its video and edit the golden."
      >
        {fixtures.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">No fixtures yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {fixtures.map((f) => (
              <div key={f.name} className="flex items-center gap-2 py-2">
                <button
                  type="button"
                  onClick={() => void openFixture(f.name)}
                  className="flex-1 text-left"
                >
                  <div className="text-sm font-medium">{f.label || f.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(f.capturedAt).toLocaleString()} · {f.frameCount} frames ·{' '}
                    {f.appMix.slice(0, 3).join(', ') || 'no apps'}
                    {f.hasVideo ? '' : ' · no video'}
                  </div>
                </button>
                <Button variant="ghost" size="sm" onClick={() => void exportFixture(f.name)}>
                  <ExportIcon /> Export
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void deleteFixture(f.name)}>
                  <TrashIcon /> Delete
                </Button>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
    </div>
  )
}

function FixtureReview({
  fixture,
  goldenDraft,
  dirty,
  onGoldenChange,
  onSave,
  onBack,
}: {
  fixture: EvalFixtureLoad
  goldenDraft: string
  dirty: boolean
  onGoldenChange: (value: string) => void
  onSave: () => void
  onBack: () => void
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeftIcon /> Back
        </Button>
        <div className="text-sm font-medium">{fixture.label || fixture.name}</div>
      </div>

      <div className="grid grid-cols-2 gap-4 items-start">
        {/* Video sticks in view while the golden.md editor scrolls beside it. */}
        <Card className="sticky top-2 self-start">
          <CardContent className="p-3">
            {fixture.videoUrl ? (
              <video
                ref={videoRef}
                src={fixture.videoUrl}
                controls
                className="w-full rounded-md bg-black"
              />
            ) : (
              <p className="text-sm text-muted-foreground">No video for this fixture.</p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              golden.md
            </span>
            <Button size="sm" onClick={onSave} disabled={!dirty}>
              <FloppyDiskIcon /> Save golden
            </Button>
          </div>
          <Textarea
            value={goldenDraft}
            onChange={(e) => onGoldenChange(e.target.value)}
            spellCheck={false}
            className="h-[70vh] resize-none overflow-auto font-mono text-xs leading-relaxed"
          />
        </div>
      </div>
    </div>
  )
}
