import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  ExportIcon,
  FloppyDiskIcon,
  TrashIcon,
  WarningCircleIcon,
  XCircleIcon,
  XIcon,
} from '@phosphor-icons/react'
import { Button } from '@components/ui/button'
import { Card, CardContent } from '@components/ui/card'
import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import type { MainWindowAPI } from '@types'
import type { EvalFixtureLoad, GoldenBlock, RecordingScript } from '@/shared/eval-review'
import { formatClock } from '@/renderer/lib/recording-steps'
import { cn } from '@/renderer/lib/utils'

export function FixtureReview({
  api,
  name,
  script,
  hasNext,
  onBack,
  onRerecord,
  onNext,
  onExport,
  onDeleted,
}: {
  api: MainWindowAPI
  name: string
  script: RecordingScript | null
  hasNext: boolean
  onBack: () => void
  onRerecord: (scriptId: string) => void
  onNext: () => void
  onExport: (name: string) => void
  onDeleted: () => void
}): React.JSX.Element {
  const [fixture, setFixture] = useState<EvalFixtureLoad | null>(null)
  const [blocks, setBlocks] = useState<GoldenBlock[]>([])
  const [rawDraft, setRawDraft] = useState<string | null>(null)
  const [labelByHand, setLabelByHand] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const load = useCallback(async () => {
    const loaded = await api.evalLoadFixture(name)
    if (!loaded) {
      toast.error('Failed to load recording')
      return
    }
    setFixture(loaded)
    setBlocks(loaded.goldenBlocks)
    setRawDraft(null)
  }, [api, name])

  useEffect(() => {
    void load()
  }, [load])

  if (!fixture) return <p className="text-sm text-muted-foreground">Loading…</p>

  const check = fixture.scriptCheck
  const failed = check !== null && !check.followed
  const showEditor = !failed || labelByHand
  const dirty =
    rawDraft !== null
      ? rawDraft !== fixture.goldenMd
      : JSON.stringify(blocks) !== JSON.stringify(fixture.goldenBlocks)

  const save = async (): Promise<boolean> => {
    if (!dirty) return true
    const result =
      rawDraft !== null
        ? await api.evalSaveGolden(fixture.name, rawDraft)
        : await api.evalSaveGoldenBlocks(fixture.name, blocks)
    if (!result.success) {
      toast.error(result.error ?? 'Failed to save')
      return false
    }
    toast.success('Saved')
    await load()
    return true
  }

  const remove = async (): Promise<void> => {
    const result = await api.evalDeleteFixture(fixture.name)
    if (!result.success) {
      toast.error(result.error ?? 'Delete failed')
      return
    }
    onDeleted()
  }

  const seek = (block: Pick<GoldenBlock, 'startOffsetMs' | 'endOffsetMs'>): void => {
    if (!videoRef.current) return
    const nextFrameSec = Math.floor(block.startOffsetMs / 1000) + 1
    const lastSec = Math.max(block.startOffsetMs, block.endOffsetMs - 100) / 1000
    videoRef.current.currentTime = Math.min(nextFrameSec, lastSec)
    void videoRef.current.play()
  }

  const updateBlock = (index: number, patch: Partial<GoldenBlock>): void =>
    setBlocks((current) => current.map((b, i) => (i === index ? { ...b, ...patch } : b)))

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2.5">
        <ArrowLeftIcon /> Eval scenarios
      </Button>
      <div className="flex items-center gap-3">
        <h2 className="flex-1 text-base font-medium">{script?.title ?? fixture.name}</h2>
        {check && (
          <span className="flex items-center gap-1 text-sm font-medium">
            {check.followed ? (
              <>
                <CheckCircleIcon className="size-4 text-primary" /> All steps matched
              </>
            ) : (
              <>
                <WarningCircleIcon className="size-4 text-destructive" />
                {check.steps
                  ? `${check.steps.filter((s) => s.ok).length} of ${check.steps.length} steps matched`
                  : "Didn't match the script"}
              </>
            )}
          </span>
        )}
      </div>
      {check?.followed && (
        <p className="text-sm text-muted-foreground">
          Summaries are filled in from the script. Check them against the video and edit if needed.
          {check.strays?.length ? ` Strays marked DROPPED: ${check.strays.join(' · ')}.` : ''}
        </p>
      )}

      {failed && script && (
        <CheckCard
          script={script}
          check={check}
          labelByHand={labelByHand}
          onLabelByHand={() => setLabelByHand(true)}
          onRerecord={() => onRerecord(script.id)}
        />
      )}

      <div className="space-y-2">
        {fixture.videoUrl ? (
          <video
            ref={videoRef}
            src={fixture.videoUrl}
            controls
            className="max-h-[40vh] w-full rounded-md bg-black"
          />
        ) : (
          <p className="text-sm text-muted-foreground">No video for this recording.</p>
        )}
        <SegmentBar blocks={fixture.goldenBlocks} onSeek={seek} />
      </div>

      {showEditor &&
        (rawDraft !== null ? (
          <RawGoldenEditor fixture={fixture} draft={rawDraft} onChange={setRawDraft} />
        ) : (
          <div className="space-y-3">
            {blocks.map((block, i) => (
              <BlockEditor
                key={i}
                index={i}
                block={block}
                onChange={(patch) => updateBlock(i, patch)}
                onSeek={() => seek(block)}
              />
            ))}
          </div>
        ))}

      <div className="flex items-center gap-2 border-t pt-4">
        {confirmDelete ? (
          <>
            <span className="text-sm text-muted-foreground">Delete this recording?</span>
            <Button variant="destructive" size="sm" onClick={() => void remove()}>
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
            <TrashIcon /> Delete
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => onExport(fixture.name)}>
          <ExportIcon /> Export
        </Button>
        {showEditor && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRawDraft(rawDraft === null ? fixture.goldenMd : null)}
            disabled={dirty}
          >
            {rawDraft === null ? 'Edit golden.md' : 'Edit by step'}
          </Button>
        )}
        <div className="flex-1" />
        {showEditor && (
          <Button variant="outline" onClick={() => void save()} disabled={!dirty}>
            <FloppyDiskIcon /> Save
          </Button>
        )}
        {showEditor && script && hasNext && (
          <Button
            onClick={() =>
              void save().then((ok) => {
                if (ok) onNext()
              })
            }
          >
            Save and record next <CaretRightIcon />
          </Button>
        )}
      </div>
    </div>
  )
}

function CheckCard({
  script,
  check,
  labelByHand,
  onLabelByHand,
  onRerecord,
}: {
  script: RecordingScript
  check: NonNullable<EvalFixtureLoad['scriptCheck']>
  labelByHand: boolean
  onLabelByHand: () => void
  onRerecord: () => void
}): React.JSX.Element {
  const countIssue = check.strays === undefined && check.expected !== check.produced
  return (
    <Card>
      <CardContent className="space-y-3">
        {countIssue && (
          <p className="text-sm">
            The script expects {check.expected} activities, the recording has {check.produced}.
          </p>
        )}
        {check.strays && check.strays.length > 0 && (
          <p className="text-sm">Strays marked DROPPED: {check.strays.join(' · ')}</p>
        )}
        {check.steps ? (
          <ol className="divide-y divide-border">
            {check.steps.map((step, i) => (
              <li key={i} className="flex gap-3 py-2 text-sm">
                {step.ok ? (
                  <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                ) : (
                  <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                )}
                <div>
                  <div className="font-medium">
                    {i + 1}. {script.steps[i]?.instruction}
                  </div>
                  <div className="text-muted-foreground">{step.issue ?? step.got}</div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {check.issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Record again, or if you did follow the script, this is a pipeline bug: label it by hand.
        </p>
        <div className="flex justify-end gap-2">
          {!labelByHand && (
            <Button variant="outline" onClick={onLabelByHand}>
              Keep and label by hand
            </Button>
          )}
          <Button onClick={onRerecord}>
            <ArrowClockwiseIcon /> Record again
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function SegmentBar({
  blocks,
  onSeek,
}: {
  blocks: GoldenBlock[]
  onSeek: (block: GoldenBlock) => void
}): React.JSX.Element | null {
  if (blocks.length === 0) return null
  return (
    <div className="flex h-6 overflow-hidden rounded-md ring-1 ring-foreground/10">
      {blocks.map((block, i) => (
        <button
          key={i}
          type="button"
          title={`${block.appName}${block.tld ? ` · ${block.tld}` : ''}`}
          onClick={() => onSeek(block)}
          style={{ flexGrow: Math.max(1, block.endOffsetMs - block.startOffsetMs) }}
          className={cn(
            'min-w-6 basis-0 border-r text-xs last:border-r-0 hover:bg-muted',
            block.dropped && 'bg-muted text-muted-foreground',
          )}
        >
          {i + 1}
        </button>
      ))}
    </div>
  )
}

function BlockEditor({
  index,
  block,
  onChange,
  onSeek,
}: {
  index: number
  block: GoldenBlock
  onChange: (patch: Partial<GoldenBlock>) => void
  onSeek: () => void
}): React.JSX.Element {
  const [mention, setMention] = useState('')
  const mentions = block.mustMention ?? []
  const seconds = Math.round((block.endOffsetMs - block.startOffsetMs) / 1000)

  const addMention = (): void => {
    const value = mention.trim()
    if (!value || mentions.includes(value)) return
    onChange({ mustMention: [...mentions, value] })
    setMention('')
  }

  return (
    <Card size="sm">
      <CardContent className="space-y-2">
        <button
          type="button"
          onClick={onSeek}
          className="flex gap-2 text-left text-sm hover:underline"
        >
          <span className="font-medium">Activity {index + 1}</span>
          <span className="text-muted-foreground">
            {block.appName}
            {block.tld && ` · ${block.tld}`} · {formatClock(block.startOffsetMs)} · {seconds}s
          </span>
        </button>
        {block.dropped ? (
          <p className="text-sm text-muted-foreground">Expected to be dropped. {block.summary}</p>
        ) : (
          <>
            <Textarea
              aria-label={`Expected summary for activity ${index + 1}`}
              value={block.summary}
              onChange={(e) => onChange({ summary: e.target.value })}
              className="min-h-16 resize-none text-sm"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Must mention</span>
              {mentions.map((m) => (
                <span
                  key={m}
                  className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                >
                  {m}
                  <button
                    type="button"
                    aria-label={`Remove ${m}`}
                    onClick={() => onChange({ mustMention: mentions.filter((x) => x !== m) })}
                  >
                    <XIcon className="size-3" />
                  </button>
                </span>
              ))}
              <Input
                value={mention}
                onChange={(e) => setMention(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addMention()
                }}
                onBlur={addMention}
                placeholder="Add a fact"
                className="h-6 w-32 text-xs"
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function RawGoldenEditor({
  fixture,
  draft,
  onChange,
}: {
  fixture: EvalFixtureLoad
  draft: string
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 items-start gap-4">
      <EventTimeline windows={fixture.eventWindows} />
      <div className="space-y-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          golden.md
        </span>
        <Textarea
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="h-[60vh] resize-none overflow-auto font-mono text-xs leading-relaxed"
        />
      </div>
    </div>
  )
}

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
      <div className="h-[60vh] overflow-auto rounded-md border p-3 font-mono text-xs leading-relaxed">
        {windows.length === 0 ? (
          <p className="text-muted-foreground">No interaction events.</p>
        ) : (
          windows.map((w, i) => (
            <div key={i} className="mb-3 last:mb-0">
              <div className="flex items-baseline gap-2">
                <span className="font-medium">
                  {formatClock(w.startOffsetMs)} → {formatClock(w.endOffsetMs)}
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
                      {formatClock(e.offsetMs)}
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
