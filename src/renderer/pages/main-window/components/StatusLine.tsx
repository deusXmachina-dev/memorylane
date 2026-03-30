import type { LlmHealthStatus } from '@types'

interface StatusLineProps {
  capturing: boolean
  llmHealth: LlmHealthStatus | null
  activityCount: number | null
}

function describeLlmHealth(llmHealth: LlmHealthStatus | null): string | null {
  if (!llmHealth) return null
  if (llmHealth.state === 'failing') {
    const requestsLabel = llmHealth.consecutiveFailures === 1 ? 'request' : 'requests'
    return `LLM issue: last ${llmHealth.consecutiveFailures} ${requestsLabel} failed`
  }
  return null
}

function formatCount(n: number): string {
  if (n >= 10_000) {
    return `${(n / 1000).toFixed(1)}k`
  }
  return n.toLocaleString()
}

export function StatusLine({
  capturing,
  llmHealth,
  activityCount,
}: StatusLineProps): React.JSX.Element {
  const healthWarning = describeLlmHealth(llmHealth)

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
          capturing ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/40'
        }`}
      />
      {capturing ? (
        <span>
          Analyzing{activityCount !== null ? ` · ${formatCount(activityCount)} activities` : ''}
        </span>
      ) : (
        <span>
          {activityCount !== null ? `${formatCount(activityCount)} activities · ` : ''}Paused
        </span>
      )}
      {healthWarning && <span className="text-destructive ml-1">· {healthWarning}</span>}
    </div>
  )
}
