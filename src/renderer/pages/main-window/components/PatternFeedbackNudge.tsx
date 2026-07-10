import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card'
import { Button } from '@components/ui/button'
import type { PatternInfo } from '@types'

const STORAGE_KEY = 'lastPatternFeedbackDate'

export function pickNudgeCandidate(patterns: PatternInfo[]): PatternInfo | null {
  const unscored = patterns.filter(
    (p) => p.approvedAt === null && p.rejectedAt === null && p.completedAt === null,
  )
  if (unscored.length === 0) return null
  return unscored.reduce((best, p) => (p.sightingCount > best.sightingCount ? p : best))
}

interface PatternFeedbackNudgeProps {
  patterns: PatternInfo[]
  onApprove: (id: string) => void
  onDismiss: (id: string, name: string) => void
}

export function PatternFeedbackNudge({
  patterns,
  onApprove,
  onDismiss,
}: PatternFeedbackNudgeProps): React.JSX.Element | null {
  const [hidden, setHidden] = useState(() => {
    const last = localStorage.getItem(STORAGE_KEY)
    return last === new Date().toISOString().slice(0, 10)
  })
  const [expanded, setExpanded] = useState(false)

  const candidate = pickNudgeCandidate(patterns)

  useEffect(() => {
    if (!candidate || hidden) return
    const handler = (e: KeyboardEvent): void => {
      if (e.repeat) return
      if (e.key === 'a') {
        e.preventDefault()
        score(() => onApprove(candidate.id))
      } else if (e.key === 'd') {
        e.preventDefault()
        score(() => onDismiss(candidate.id, candidate.name))
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [candidate, hidden, onApprove, onDismiss])

  if (!candidate || hidden) return null

  const score = (action: () => void): void => {
    action()
    localStorage.setItem(STORAGE_KEY, new Date().toISOString().slice(0, 10))
    setHidden(true)
  }

  return (
    <Card>
      <CardHeader>
        <p className="text-xs text-muted-foreground">Quick feedback improves pattern detection</p>
        <CardTitle className="text-sm flex items-baseline gap-1.5">
          <span className="truncate">{candidate.name}</span>
          {!expanded && (
            <button
              className="text-xs underline text-muted-foreground hover:text-foreground shrink-0"
              onClick={() => setExpanded(true)}
            >
              more..
            </button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {expanded && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
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
                {candidate.sightingCount}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {candidate.description || candidate.automationIdea}
            </p>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            onClick={() => score(() => onApprove(candidate.id))}
          >
            <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-white/20 bg-white/10 px-1 text-[10px] font-medium mr-1.5">
              A
            </kbd>
            Useful
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="flex-1"
            onClick={() => score(() => onDismiss(candidate.id, candidate.name))}
          >
            Not useful
            <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-current/20 bg-current/10 px-1 text-[10px] font-medium ml-1.5">
              D
            </kbd>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
