import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@components/ui/card'
import { ThumbsUp, ThumbsDown } from 'lucide-react'
import type { MainWindowAPI, PatternInfo } from '@types'

const SIGHTING_FILTERS = [
  { label: 'All', min: 1 },
  { label: '3+', min: 3 },
  { label: '5+', min: 5 },
  { label: '10+', min: 10 },
] as const

interface PatternsSectionProps {
  api: MainWindowAPI
}

export function PatternsSection({ api }: PatternsSectionProps): React.JSX.Element | null {
  const [allPatterns, setAllPatterns] = useState<PatternInfo[] | null>(null)
  const [minSightings, setMinSightings] = useState(3)
  const [detectionEnabled, setDetectionEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    api
      .getPatterns()
      .then(setAllPatterns)
      .catch(() => setAllPatterns([]))
    api
      .getCaptureSettings()
      .then((s) => setDetectionEnabled(s.patternDetectionEnabled))
      .catch(() => setDetectionEnabled(true))
  }, [api])

  const patterns = useMemo(
    () => allPatterns?.filter((p) => p.sightingCount >= minSightings) ?? null,
    [allPatterns, minSightings],
  )

  const handleApprove = useCallback(
    (id: string) => {
      setAllPatterns((prev) =>
        prev ? prev.map((p) => (p.id === id ? { ...p, approvedAt: Date.now() } : p)) : prev,
      )
      toast.success('Thanks for the feedback!')
      api.approvePattern(id).catch(() => {
        // approval persisted best-effort
      })
    },
    [api],
  )

  const handleDismiss = useCallback(
    (id: string, name: string) => {
      setAllPatterns((prev) => (prev ? prev.filter((p) => p.id !== id) : prev))
      toast.success(`Not useful — "${name}" hidden`)
      api.rejectPattern(id).catch(() => {
        // rejection persisted best-effort
      })
    },
    [api],
  )

  const handleCopyPrompt = useCallback(
    (pattern: PatternInfo) => {
      const prompt = [
        `I want to automate this recurring workflow: "${pattern.name}".`,
        ``,
        `Use the MemoryLane MCP tools to research it before proposing a solution:`,
        ``,
        `1. Run search_patterns with query "${pattern.name}" to find the pattern and get its ID.`,
        `2. Run get_pattern_details with that pattern ID to see all sightings and the evidence for each.`,
        `3. Pick 3-5 sightings with the highest confidence and collect their activity IDs.`,
        `4. Run get_activity_details on those activity IDs to read the actual on-screen text (OCR) — this shows exactly what I was doing step by step.`,
        `5. Based on the real evidence, propose a concrete automation plan: what triggers the workflow, what each step does, and which tools or integrations to use (apps involved: ${pattern.apps.join(', ')}).`,
        ``,
        `Keep the plan actionable — specific tools, APIs, or scripts I can set up, not vague advice.`,
      ].join('\n')
      navigator.clipboard.writeText(prompt).then(() => {
        toast.success('Copied! Paste it into your Claude desktop app')
      })
      api.markPatternPromptCopied(pattern.id).catch(() => {
        // timestamp persisted best-effort
      })
    },
    [api],
  )

  if (allPatterns === null) return null

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

  if (allPatterns.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Automation Opportunities</h2>
        <Badge variant="secondary">{patterns?.length ?? 0} found</Badge>
      </div>

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

      {patterns?.map((pattern) => (
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
              {pattern.automationIdea || pattern.description}
            </p>
            <Button size="sm" className="w-full" onClick={() => handleCopyPrompt(pattern)}>
              Copy prompt for Claude
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
