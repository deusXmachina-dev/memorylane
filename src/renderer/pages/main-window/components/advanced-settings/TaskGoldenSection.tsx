import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeftIcon,
  ArrowClockwiseIcon,
  ExportIcon,
  FloppyDiskIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import type { MainWindowAPI } from '@types'
import type { TaskFixtureLoad, TaskFixtureSummary, TaskSightingSummary } from '@/shared/eval-review'
import { SettingsSection } from './SettingsSection'

type Selection =
  | { kind: 'sighting'; sighting: TaskSightingSummary }
  | { kind: 'fixture'; name: string }
  | null

export function TaskGoldenSection({ api }: { api: MainWindowAPI }): React.JSX.Element {
  const [sightings, setSightings] = useState<TaskSightingSummary[]>([])
  const [fixtures, setFixtures] = useState<TaskFixtureSummary[]>([])
  const [selected, setSelected] = useState<Selection>(null)

  const refresh = useCallback(async () => {
    const [s, f] = await Promise.all([api.evalListTaskSightings(), api.evalListTaskFixtures()])
    setSightings(s)
    setFixtures(f)
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const deleteFixture = useCallback(
    async (name: string) => {
      const result = await api.evalDeleteTaskFixture(name)
      if (!result.success) {
        toast.error(result.error ?? 'Delete failed')
        return
      }
      await refresh()
    },
    [api, refresh],
  )

  const exportFixture = useCallback(
    async (name: string) => {
      const result = await api.evalExportTaskFixture(name)
      if (!result.success) {
        if (result.error !== 'Canceled') toast.error(result.error ?? 'Export failed')
        return
      }
      toast.success('Golden exported')
    },
    [api],
  )

  if (selected?.kind === 'sighting') {
    return (
      <SightingPromote
        api={api}
        sighting={selected.sighting}
        onDone={async () => {
          setSelected(null)
          await refresh()
        }}
        onBack={() => setSelected(null)}
      />
    )
  }

  if (selected?.kind === 'fixture') {
    return (
      <TaskFixtureReview
        api={api}
        name={selected.name}
        onExport={() => exportFixture(selected.name)}
        onDelete={async () => {
          await deleteFixture(selected.name)
          setSelected(null)
        }}
        onBack={() => setSelected(null)}
      />
    )
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Sightings"
        description="Pick a detected sighting to turn into a golden. You'll edit its task description and choose how much surrounding activity (noise) to include."
      >
        {sightings.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">
            No sightings yet — run the app so it detects patterns first.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {sightings.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelected({ kind: 'sighting', sighting: s })}
                className="block w-full py-2 text-left"
              >
                <div className="text-sm font-medium">{s.patternName}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(s.detectedAt).toLocaleString()} · {s.activityCount} activities ·{' '}
                  {s.apps.slice(0, 3).join(', ') || 'no apps'}
                </div>
                {s.evidence && (
                  <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground/80">
                    {s.evidence}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="Goldens"
        description="Promoted goldens. Edit or export one to add it to the repo (evals/task-mining/fixtures)."
      >
        {fixtures.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">No goldens yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {fixtures.map((f) => (
              <div key={f.name} className="flex items-center gap-2 py-2">
                <button
                  type="button"
                  onClick={() => setSelected({ kind: 'fixture', name: f.name })}
                  className="flex-1 text-left"
                >
                  <div className="text-sm font-medium">{f.label || f.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {f.sourceDay ?? '—'} · {f.activityCount} activities
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

function clampMinutes(value: string): number {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(n, 24 * 60)
}

function SightingPromote({
  api,
  sighting,
  onDone,
  onBack,
}: {
  api: MainWindowAPI
  sighting: TaskSightingSummary
  onDone: () => void
  onBack: () => void
}): React.JSX.Element {
  const [beforeMin, setBeforeMin] = useState(60)
  const [afterMin, setAfterMin] = useState(60)
  const [name, setName] = useState('')
  const [draft, setDraft] = useState('')
  const [generated, setGenerated] = useState('')
  const [activityCount, setActivityCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const draftRef = useRef('')
  const generatedRef = useRef('')
  const nameEdited = useRef(false)
  const firstRun = useRef(true)
  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  const dirty = draft !== generated

  const loadPreview = useCallback(
    async (force: boolean) => {
      const res = await api.evalPreviewTaskGolden(sighting.id, beforeMin, afterMin)
      if (!res) {
        toast.error('Could not build a preview for this sighting')
        return
      }
      setActivityCount(res.activityCount)
      const wasDirty = draftRef.current !== '' && draftRef.current !== generatedRef.current
      generatedRef.current = res.goldenMd
      setGenerated(res.goldenMd)
      if (force || !wasDirty) setDraft(res.goldenMd)
      if (!nameEdited.current) setName(res.name)
    },
    [api, sighting.id, beforeMin, afterMin],
  )

  useEffect(() => {
    void loadPreview(firstRun.current)
    firstRun.current = false
  }, [loadPreview])

  const promote = useCallback(async () => {
    if (!name.trim()) {
      toast.error('Name the golden first')
      return
    }
    setBusy(true)
    const result = await api.evalPromoteTaskSighting(sighting.id, {
      beforeMin,
      afterMin,
      goldenMd: draft,
      name,
    })
    setBusy(false)
    if (!result.success) {
      toast.error(result.error ?? 'Promote failed')
      return
    }
    toast.success(`Golden "${result.fixture?.name}" created`)
    onDone()
  }, [api, sighting.id, beforeMin, afterMin, draft, name, onDone])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeftIcon /> Back
        </Button>
        <div className="text-sm font-medium">{sighting.patternName}</div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-xs text-muted-foreground">
          <div>Golden name</div>
          <Input
            value={name}
            onChange={(e) => {
              nameEdited.current = true
              setName(e.target.value)
            }}
            className="w-64"
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <div>Minutes before</div>
          <Input
            type="number"
            min={0}
            value={beforeMin}
            onChange={(e) => setBeforeMin(clampMinutes(e.target.value))}
            className="w-24"
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <div>Minutes after</div>
          <Input
            type="number"
            min={0}
            value={afterMin}
            onChange={(e) => setAfterMin(clampMinutes(e.target.value))}
            className="w-24"
          />
        </label>
        <span className="pb-2 text-xs text-muted-foreground">
          {activityCount === null ? '…' : `${activityCount} activities in window`}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            golden.md
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadPreview(true)}
              disabled={!dirty}
              title="Rebuild the draft from the current window (discards edits)"
            >
              <ArrowClockwiseIcon /> Regenerate
            </Button>
            <Button size="sm" onClick={() => void promote()} disabled={busy}>
              <FloppyDiskIcon /> Promote to golden
            </Button>
          </div>
        </div>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="min-h-[420px] font-mono text-xs leading-relaxed"
        />
      </div>
    </div>
  )
}

function TaskFixtureReview({
  api,
  name,
  onExport,
  onDelete,
  onBack,
}: {
  api: MainWindowAPI
  name: string
  onExport: () => void
  onDelete: () => void
  onBack: () => void
}): React.JSX.Element {
  const [loaded, setLoaded] = useState<TaskFixtureLoad | null>(null)
  const [draft, setDraft] = useState('')
  const dirty = loaded !== null && draft !== loaded.goldenMd

  useEffect(() => {
    void (async () => {
      const f = await api.evalLoadTaskFixture(name)
      if (!f) {
        toast.error('Failed to load golden')
        return
      }
      setLoaded(f)
      setDraft(f.goldenMd)
    })()
  }, [api, name])

  const save = useCallback(async () => {
    if (!loaded) return
    const result = await api.evalSaveTaskGolden(loaded.name, draft)
    if (!result.success) {
      toast.error(result.error ?? 'Failed to save golden')
      return
    }
    setLoaded({ ...loaded, goldenMd: draft })
    toast.success('Golden saved')
  }, [api, loaded, draft])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeftIcon /> Back
        </Button>
        <div className="flex-1 text-sm font-medium">{loaded?.label || name}</div>
        <Button variant="ghost" size="sm" onClick={onExport}>
          <ExportIcon /> Export
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete}>
          <TrashIcon /> Delete
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            golden.md
          </span>
          <Button size="sm" onClick={() => void save()} disabled={!dirty}>
            <FloppyDiskIcon /> Save golden
          </Button>
        </div>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="min-h-[420px] font-mono text-xs leading-relaxed"
        />
      </div>
    </div>
  )
}
