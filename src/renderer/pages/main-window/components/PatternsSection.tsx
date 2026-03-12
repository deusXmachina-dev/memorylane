import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@components/ui/card'

interface MockPattern {
  id: string
  name: string
  description: string
  apps: string[]
  timeSaved: string
  sightingCount: number
}

const MOCK_PATTERNS: MockPattern[] = [
  {
    id: '1',
    name: 'Daily standup compilation',
    description: 'Compile team updates from multiple Slack channels',
    apps: ['Slack', 'Google Sheets'],
    timeSaved: '~2 hrs/week',
    sightingCount: 12,
  },
  {
    id: '2',
    name: 'Expense receipt filing',
    description: 'Save and organize receipt attachments from email',
    apps: ['Gmail', 'Google Drive'],
    timeSaved: '~45 min/week',
    sightingCount: 8,
  },
  {
    id: '3',
    name: 'PR review notifications',
    description: 'Check and summarize open pull requests',
    apps: ['GitHub', 'Slack'],
    timeSaved: '~30 min/week',
    sightingCount: 5,
  },
]

export function PatternsSection(): React.JSX.Element | null {
  const [dismissedIds, setDismissedIds] = useState<string[]>([])

  const handleDismiss = useCallback((id: string, name: string) => {
    setDismissedIds((prev) => [...prev, id])
    toast.success(`Dismissed "${name}"`)
  }, [])

  const handleCopyPrompt = useCallback((pattern: MockPattern) => {
    const prompt = `I have a repetitive task: "${pattern.name}" — ${pattern.description}. It involves these apps: ${pattern.apps.join(', ')}. Help me automate this workflow step by step.`
    navigator.clipboard.writeText(prompt).then(() => {
      toast.success('Copied! Paste it into your Claude desktop app')
    })
  }, [])

  const visiblePatterns = MOCK_PATTERNS.filter((p) => !dismissedIds.includes(p.id))

  if (visiblePatterns.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Automation Opportunities</h2>
        <Badge variant="secondary">{visiblePatterns.length} found</Badge>
      </div>

      {visiblePatterns.map((pattern) => (
        <Card key={pattern.id}>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              {pattern.name}
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
            </CardTitle>
            <CardAction>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => handleDismiss(pattern.id, pattern.name)}
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Badge variant="default">{pattern.timeSaved}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{pattern.description}</p>
            <Button size="sm" className="w-full" onClick={() => handleCopyPrompt(pattern)}>
              Copy prompt for Claude
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
