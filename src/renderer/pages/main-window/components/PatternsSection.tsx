import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@components/ui/card'
import { ThumbsUp, ThumbsDown, Check, Undo2, ChevronDown, ChevronUp } from 'lucide-react'
import type { MainWindowAPI, PatternInfo } from '@types'
import { PatternFeedbackNudge } from './PatternFeedbackNudge'

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

  useEffect(() => {
    api
      .getCaptureSettings()
      .then((s) => setDetectionEnabled(s.patternDetectionEnabled))
      .catch(() => setDetectionEnabled(true))
  }, [api])

  const { activePatterns, completedPatterns } = useMemo(() => {
    const filtered = patterns.filter((p) => p.sightingCount >= minSightings)
    const active = filtered
      .filter((p) => !p.completedAt)
      .sort((a, b) => b.sightingCount - a.sightingCount)
    const completed = filtered
      .filter((p) => p.completedAt)
      .sort((a, b) => b.sightingCount - a.sightingCount)
    return { activePatterns: active, completedPatterns: completed }
  }, [patterns, minSightings])

  const handleApprove = useCallback(
    (id: string) => {
      toast.success('Thanks for the feedback!')
      api.approvePattern(id).catch(() => {
        // approval persisted best-effort
      })
      onPatternsChange()
    },
    [api, onPatternsChange],
  )

  const handleDismiss = useCallback(
    (id: string, name: string) => {
      toast.success(`Not useful — "${name}" hidden`)
      api.rejectPattern(id).catch(() => {
        // rejection persisted best-effort
      })
      onPatternsChange()
    },
    [api, onPatternsChange],
  )

  const handleComplete = useCallback(
    (id: string) => {
      api.completePattern(id).catch(() => {
        // completion persisted best-effort
      })
      onPatternsChange()
    },
    [api, onPatternsChange],
  )

  const handleUncomplete = useCallback(
    (id: string) => {
      api.uncompletePattern(id).catch(() => {
        // uncomplete persisted best-effort
      })
      onPatternsChange()
    },
    [api, onPatternsChange],
  )

  const [showCompleted, setShowCompleted] = useState(false)

  const handleCopyPrompt = useCallback(
    (pattern: PatternInfo) => {
      const prompt = [
        `I want to automate this recurring workflow: "${pattern.name}".`,
        ``,
        `## Step 1 — Research`,
        ``,
        `Use the MemoryLane MCP tools to understand what this pattern really involves:`,
        ``,
        `1. Call get_pattern_details with pattern ID "${pattern.id}" to see all sightings.`,
        `2. Pick 3-5 sightings with the highest confidence and call get_activity_details on their activity IDs to read the OCR evidence — this shows exactly what I was doing.`,
        `3. For each of those sightings, call browse_timeline around the sighting timestamp (±15 minutes) to see what happened before and after. This gives you context about the full workflow — what triggers it and what follows.`,
        ``,
        `## Step 2 — Ask me questions`,
        ``,
        `Before building anything, ask me clarifying questions:`,
        `- Which steps vary between occurrences?`,
        `- What inputs or variables are needed?`,
        `- What tools, APIs, or services do I have available?`,
        `- Anything else you need to know to build a good automation.`,
        ``,
        `Wait for my answers before proceeding.`,
        ``,
        `## Step 3 — Create a Claude Code skill`,
        ``,
        `Based on your research and my answers, use /skill-creator to create a skill. Give it a brief that includes:`,
        `- What triggers the workflow`,
        `- Step-by-step actions the skill should perform`,
        `- Apps involved: ${pattern.apps.join(', ')}`,
        `- Variable inputs the skill needs to ask for`,
      ].join('\n')
      navigator.clipboard.writeText(prompt).then(() => {
        toast.success('Copied! Paste it into Claude Cowork')
      })
      api.markPatternPromptCopied(pattern.id).catch(() => {
        // timestamp persisted best-effort
      })
    },
    [api],
  )

  if (detectionEnabled === false) {
    return (
      <div className="space-y-3">
        <h2 className="text-sm font-medium">Automation Opportunities</h2>
        <p className="text-xs text-muted-foreground">
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
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Automation Opportunities</h2>
        <Badge variant="secondary">{activePatterns.length + completedPatterns.length} found</Badge>
      </div>

      <PatternFeedbackNudge
        patterns={patterns}
        onApprove={handleApprove}
        onDismiss={handleDismiss}
      />

      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground mr-1">Sightings:</span>
        {SIGHTING_FILTERS.map((f) => (
          <button
            key={f.min}
            onClick={() => setMinSightings(f.min)}
            className={`px-2 py-0.5 rounded-full text-xs transition-colors ${
              minSightings === f.min
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {activePatterns.map((pattern) => (
        <Card key={pattern.id}>
          <CardHeader>
            <CardTitle className="text-sm">
              {pattern.name}
              <div className="flex items-center gap-1.5 mt-1">
                <span className="inline-flex items-center gap-0.5 text-xs font-normal text-muted-foreground">
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                  {pattern.sightingCount}
                </span>
              </div>
            </CardTitle>
            <CardAction>
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => handleComplete(pattern.id)}
                  title="Mark as done"
                >
                  <Check className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => handleApprove(pattern.id)}
                  className={pattern.approvedAt ? 'text-green-500' : ''}
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => handleDismiss(pattern.id, pattern.name)}
                >
                  <ThumbsDown className="w-3.5 h-3.5 scale-x-[-1]" />
                </Button>
              </div>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {pattern.description || pattern.automationIdea}
            </p>
            <Button size="sm" className="w-full" onClick={() => handleCopyPrompt(pattern)}>
              Copy prompt for Claude
            </Button>
          </CardContent>
        </Card>
      ))}

      {completedPatterns.length > 0 && (
        <>
          <button
            onClick={() => setShowCompleted((prev) => !prev)}
            className="flex items-center gap-1 text-xs text-muted-foreground pt-1 hover:text-foreground transition-colors"
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
              <Card key={pattern.id} className="opacity-60">
                <CardHeader>
                  <CardTitle className="text-sm">
                    {pattern.name}
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="inline-flex items-center gap-0.5 text-xs font-normal text-muted-foreground">
                        <svg
                          className="w-3 h-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                          />
                        </svg>
                        {pattern.sightingCount}
                      </span>
                    </div>
                  </CardTitle>
                  <CardAction>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleUncomplete(pattern.id)}
                      title="Mark as not completed"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                    </Button>
                  </CardAction>
                </CardHeader>
              </Card>
            ))}
        </>
      )}
    </div>
  )
}
