import * as React from 'react'
import { cn } from '@/renderer/lib/utils'
import type { LlmHealthStatus, Vendor } from '@types'

const VENDOR_LABELS: Record<Vendor, string> = {
  openrouter: 'OpenRouter',
  google: 'Google Vertex',
  'openai-compatible': 'OpenAI compatible',
}

interface LlmStatusPanelProps {
  vendor: Vendor
  modelLabel: string | null
  llmHealth: LlmHealthStatus | null
  configured: boolean
  onClick: () => void
}

function dotClass(configured: boolean, llmHealth: LlmHealthStatus | null): string {
  if (!configured) return 'bg-muted-foreground/40'
  if (!llmHealth) return 'bg-muted-foreground/40'
  switch (llmHealth.state) {
    case 'active':
      return 'bg-emerald-500'
    case 'failing':
      return 'bg-destructive'
    case 'unknown':
      return 'bg-amber-500'
    case 'not_configured':
    default:
      return 'bg-muted-foreground/40'
  }
}

function stateLabel(configured: boolean, llmHealth: LlmHealthStatus | null): string {
  if (!configured) return 'Not configured'
  if (!llmHealth) return 'Checking…'
  switch (llmHealth.state) {
    case 'active':
      return 'Connected'
    case 'failing':
      return 'Failing'
    case 'unknown':
      return 'Checking…'
    case 'not_configured':
    default:
      return 'Not configured'
  }
}

export function LlmStatusPanel({
  vendor,
  modelLabel,
  llmHealth,
  configured,
  onClick,
}: LlmStatusPanelProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex flex-col gap-1 w-full text-left px-3 py-2.5 rounded-lg',
        'border border-sidebar-border bg-sidebar-accent/40',
        'hover:bg-sidebar-accent/70 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
      )}
      aria-label="LLM status — open AI Models settings"
    >
      <div className="flex items-center gap-2 text-xs text-sidebar-foreground/70">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', dotClass(configured, llmHealth))} />
        <span>{VENDOR_LABELS[vendor]}</span>
        <span className="ml-auto">{stateLabel(configured, llmHealth)}</span>
      </div>
      {modelLabel && (
        <div className="font-mono text-[11px] text-sidebar-foreground/60 truncate">
          {modelLabel}
        </div>
      )}
    </button>
  )
}
