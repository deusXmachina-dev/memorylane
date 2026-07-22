import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { ScrollArea } from '@components/ui/scroll-area'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { MainWindowAPI, PatternInfo } from '@types'
import { PatternFeedbackNudge } from './PatternFeedbackNudge'
import { PatternListItem } from './PatternListItem'
import { PatternDetailPane } from './PatternDetailPane'
import { buildPatternAnalyzePrompt } from './claude-prompts'

const SIGHTING_FILTERS = [
  { label: 'All', min: 1 },
  { label: '3+', min: 3 },
  { label: '5+', min: 5 },
  { label: '10+', min: 10 },
] as const

interface PatternsSectionProps {
  api: MainWindowAPI
  patterns: PatternInfo[]
  onPatternsChange: () => void
}

export function PatternsSection({
  api,
  patterns,
  onPatternsChange,
}: PatternsSectionProps): React.JSX.Element | null {
  const [minSightings, setMinSightings] = useState(1)
  const [detectionEnabled, setDetectionEnabled] = useState<boolean | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)

  useEffect(() => {
    api
      .getCaptureSettings()
      .then((s) => setDetectionEnabled(s.patternDetectionEnabled))
      .catch(() => setDetectionEnabled(true))
  }, [api])

  const { activePatterns, completedPatterns } = useMemo(() => {
    const filtered = patterns.filter((p) => p.sightingCount >= minSightings)
    // Backend already sorts by score; preserve incoming order.
    const active = filtered.filter((p) => !p.completedAt)
    const completed = filtered.filter((p) => p.completedAt)
    return { activePatterns: active, completedPatterns: completed }
  }, [patterns, minSightings])

  // Derive the effective selection at render time: keep the user's pick if it's
  // still around, otherwise fall back to the top-ranked pattern.
  const effectiveSelectedId =
    (selectedId && patterns.some((p) => p.id === selectedId) && selectedId) ||
    activePatterns[0]?.id ||
    completedPatterns[0]?.id ||
    patterns[0]?.id ||
    null

  const selected = useMemo(
    () => patterns.find((p) => p.id === effectiveSelectedId) ?? null,
    [patterns, effectiveSelectedId],
  )

  const handleApprove = useCallback(
    (id: string) => {
      toast.success('Thanks for the feedback!')
      api.approvePattern(id).catch((err) => {
        console.warn('[patterns] approvePattern failed', err)
      })
      onPatternsChange()
    },
    [api, onPatternsChange],
  )

  const handleDismiss = useCallback(
    (id: string, name: string) => {
      toast.success(`Not useful — "${name}" hidden`)
      api.rejectPattern(id).catch((err) => {
        console.warn('[patterns] rejectPattern failed', err)
      })
      onPatternsChange()
    },
    [api, onPatternsChange],
  )

  const handleComplete = useCallback(
    (id: string) => {
      api.completePattern(id).catch((err) => {
        console.warn('[patterns] completePattern failed', err)
      })
      onPatternsChange()
    },
    [api, onPatternsChange],
  )

  const handleUncomplete = useCallback(
    (id: string) => {
      api.uncompletePattern(id).catch((err) => {
        console.warn('[patterns] uncompletePattern failed', err)
      })
      onPatternsChange()
    },
    [api, onPatternsChange],
  )

  const handleCopyPrompt = useCallback(
    (pattern: PatternInfo) => {
      navigator.clipboard
        .writeText(buildPatternAnalyzePrompt(pattern))
        .then(() => {
          toast.success('Copied! Paste it into Claude Cowork')
        })
        .catch((err) => {
          console.warn('[patterns] clipboard.writeText failed', err)
          toast.error('Could not copy prompt to clipboard')
        })
      api.markPatternPromptCopied(pattern.id).catch((err) => {
        console.warn('[patterns] markPatternPromptCopied failed', err)
      })
    },
    [api],
  )

  if (detectionEnabled === false) {
    return (
      <div className="space-y-3 max-w-xl">
        <p className="text-sm text-muted-foreground">
          MemoryLane can analyze your daily activity to find repetitive workflows you could
          automate.
        </p>
        <Button
          size="sm"
          onClick={() => {
            setDetectionEnabled(true)
            api.saveCaptureSettings({ patternDetectionEnabled: true }).then((result) => {
              if (result.success) {
                toast.success('Automation opportunities enabled')
              }
            })
          }}
        >
          Start discovering
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <PatternFeedbackNudge
        patterns={patterns}
        onApprove={handleApprove}
        onDismiss={handleDismiss}
      />

      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground mr-1">Sightings:</span>
        {SIGHTING_FILTERS.map((f) => (
          <Button
            key={f.min}
            size="sm"
            variant={minSightings === f.min ? 'default' : 'secondary'}
            className="rounded-full h-7 px-3 text-xs"
            onClick={() => setMinSightings(f.min)}
          >
            {f.label}
          </Button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {activePatterns.length + completedPatterns.length} found
        </span>
      </div>

      {patterns.length === 0 ? (
        <div className="text-sm text-muted-foreground py-12 text-center">
          No patterns yet. Keep using your computer — MemoryLane will surface repetitive workflows
          once it has enough data.
        </div>
      ) : (
        <div className="grid grid-cols-[360px_1fr] gap-4 flex-1 min-h-0">
          <ScrollArea className="border rounded-lg">
            <div className="p-2 space-y-1">
              {activePatterns.map((pattern) => (
                <PatternListItem
                  key={pattern.id}
                  pattern={pattern}
                  selected={pattern.id === effectiveSelectedId}
                  onSelect={() => setSelectedId(pattern.id)}
                />
              ))}
              {activePatterns.length === 0 && (
                <div className="text-xs text-muted-foreground p-3">
                  No patterns match this filter.
                </div>
              )}
              {completedPatterns.length > 0 && (
                <div className="pt-2">
                  <button
                    onClick={() => setShowCompleted((p) => !p)}
                    className="flex items-center gap-1 text-xs text-muted-foreground px-2 py-1 hover:text-foreground transition-colors w-full"
                  >
                    {showCompleted ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                    Completed ({completedPatterns.length})
                  </button>
                  {showCompleted &&
                    completedPatterns.map((pattern) => (
                      <PatternListItem
                        key={pattern.id}
                        pattern={pattern}
                        selected={pattern.id === effectiveSelectedId}
                        onSelect={() => setSelectedId(pattern.id)}
                      />
                    ))}
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="border rounded-lg overflow-hidden">
            {selected ? (
              <PatternDetailPane
                api={api}
                pattern={selected}
                onApprove={handleApprove}
                onDismiss={handleDismiss}
                onComplete={handleComplete}
                onUncomplete={handleUncomplete}
                onCopyPrompt={handleCopyPrompt}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                Select a pattern to see its evidence.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
