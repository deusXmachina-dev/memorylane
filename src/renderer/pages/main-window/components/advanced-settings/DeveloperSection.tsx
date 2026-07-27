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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@components/ui/tabs'
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
          <TabsTrigger value="recorder">Recorder</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
        </TabsList>
        <TabsContent value="recorder" className="pt-2">
          <RecorderSection api={api} />
        </TabsContent>
        <TabsContent value="tasks" className="pt-2">
          <div className="space-y-6">
            <TaskMaintenanceSection api={api} />
            <TaskGoldenSection api={api} />
          </div>
        </TabsContent>
      </Tabs>

      <div className="pt-2">
        <Button variant="outline" size="sm" onClick={() => setDevMode(false)}>
          Disable Developer mode
        </Button>
      </div>
    </div>
  )
}

/**
 * Wipe all mined sightings + clusters and re-mine the recent window from
 * scratch. Activities (the source data) are untouched — this only rebuilds
 * derived task data, e.g. after a prompt change.
 */
function TaskMaintenanceSection({ api }: { api: MainWindowAPI }): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const wipeAndRemine = useCallback(async () => {
    setConfirming(false)
    setBusy(true)
    toast.loading('Wiping tasks and re-mining…', { id: 'wipe-remine' })
    const result = await api.wipeAndRemineTasks()
    setBusy(false)
    if (!result.success) {
      toast.error(result.error ?? 'Wipe & re-mine failed', { id: 'wipe-remine' })
      return
    }
    const s = result.summary
    if (s?.skipped) {
      toast.error(
        s.skipped === 'no-provider'
          ? 'Tasks wiped, but re-mine skipped: no inference provider configured'
          : 'Skipped: a mining run is already in progress. Nothing was wiped — try again shortly.',
        { id: 'wipe-remine' },
      )
      return
    }
    if (s?.abortReason === 'rate-limit') {
      toast.warning(
        `Re-mined ${s.daysMined} day(s), then stopped: provider rate limited. Mining resumes shortly.`,
        { id: 'wipe-remine' },
      )
      return
    }
    toast.success(
      `Re-mined ${s?.daysMined ?? 0} day(s)` + (s?.daysFailed ? ` (${s.daysFailed} failed)` : ''),
      { id: 'wipe-remine' },
    )
  }, [api])

  const retryFailedDays = useCallback(async () => {
    const { retried } = await api.retryFailedMiningDays()
    if (retried === 0) {
      toast.info('No failed mining days to retry')
      return
    }
    toast.success(`Reopened ${retried} failed day(s) — mining resumes shortly`)
  }, [api])

  return (
    <SettingsSection
      title="Wipe & re-mine tasks"
      description="Deletes every mined sighting and cluster, then re-mines the recent window from scratch with the current prompt. Activities (the source data) are untouched."
    >
      <div className="flex items-center gap-2 py-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void retryFailedDays()}
          disabled={busy}
        >
          Retry failed days
        </Button>
        {confirming ? (
          <>
            <span className="text-sm text-muted-foreground">
              Delete all sightings + clusters and re-mine?
            </span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void wipeAndRemine()}
              disabled={busy}
            >
              Confirm
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirming(true)}
            disabled={busy}
          >
            <TrashIcon /> Wipe all tasks &amp; re-mine
          </Button>
        )}
      </div>
    </SettingsSection>
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
        <Button className="ml-auto" size="sm" onClick={onSave} disabled={!dirty}>
          <FloppyDiskIcon /> Save golden
        </Button>
      </div>

      {/* Video on top (kept small), then events + golden.md as scrollable columns. */}
      <Card>
        <CardContent className="flex justify-center p-3">
          {fixture.videoUrl ? (
            <video
              ref={videoRef}
              src={fixture.videoUrl}
              controls
              className="max-h-[40vh] w-auto rounded-md bg-black"
            />
          ) : (
            <p className="text-sm text-muted-foreground">No video for this fixture.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 items-start">
        <EventTimeline windows={fixture.eventWindows} />

        <div className="space-y-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            golden.md
          </span>
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

/** m:ss from a ms offset — same shape as golden.md timestamps. */
function formatOffset(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Read-only timeline of captured interaction events, grouped by EventWindow. */
function EventTimeline({
  windows,
}: {
  windows: EvalFixtureLoad['eventWindows']
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        events
      </span>
      <div className="h-[70vh] overflow-auto rounded-md border p-3 font-mono text-xs leading-relaxed">
        {windows.length === 0 ? (
          <p className="text-muted-foreground">No interaction events.</p>
        ) : (
          windows.map((w, i) => (
            <div key={i} className="mb-3 last:mb-0">
              <div className="flex items-baseline gap-2">
                <span className="font-medium">
                  {formatOffset(w.startOffsetMs)} → {formatOffset(w.endOffsetMs)}
                </span>
                {w.appLabel && <span className="truncate text-muted-foreground">{w.appLabel}</span>}
                <span className="ml-auto text-[10px] uppercase text-muted-foreground/70">
                  {w.closedBy}
                </span>
              </div>
              {w.events.length === 0 ? (
                <div className="pl-2 text-muted-foreground">(no events)</div>
              ) : (
                w.events.map((e, j) => (
                  <div key={j} className="flex gap-2 pl-2">
                    <span className="shrink-0 text-muted-foreground">
                      {formatOffset(e.offsetMs)}
                    </span>
                    <span>{e.text}</span>
                  </div>
                ))
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
