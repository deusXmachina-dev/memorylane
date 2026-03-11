import type { LlmHealthStatus } from '@types'

interface StatusLineProps {
  llmHealth: LlmHealthStatus | null
  activityCount: number | null
}

function describeLlmHealth(llmHealth: LlmHealthStatus | null): {
  dotClassName: string
  text: string
} | null {
  if (!llmHealth) return null

  if (llmHealth.state === 'active') {
    return { dotClassName: 'bg-emerald-500', text: 'LLM active' }
  }

  if (llmHealth.state === 'failing') {
    const requestsLabel = llmHealth.consecutiveFailures === 1 ? 'request' : 'requests'
    return {
      dotClassName: 'bg-destructive',
      text: `LLM issue: last ${llmHealth.consecutiveFailures} ${requestsLabel} failed`,
    }
  }

  if (llmHealth.state === 'unknown') {
    return { dotClassName: 'bg-muted-foreground/50', text: 'LLM ready, waiting for activity' }
  }

  return null
}

function formatCount(n: number): string {
  if (n >= 10_000) {
    return `${(n / 1000).toFixed(1)}k`
  }
  return n.toLocaleString()
}

export function StatusLine({ llmHealth, activityCount }: StatusLineProps): React.JSX.Element {
  const health = describeLlmHealth(llmHealth)

  if (!health && activityCount === null) {
    return <div className="text-xs text-muted-foreground">Loading...</div>
  }

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {health && (
        <>
          <span className={`h-2 w-2 shrink-0 rounded-full ${health.dotClassName}`} />
          <span>{health.text}</span>
        </>
      )}
      {health && activityCount !== null && <span>·</span>}
      {activityCount !== null && <span>{formatCount(activityCount)} activities captured</span>}
    </div>
  )
}
