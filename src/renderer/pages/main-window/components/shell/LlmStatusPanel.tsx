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
  llmHealth: LlmHealthStatus | null
  configured: boolean
  collapsed?: boolean
  onClick: () => void
}

// Health is reactive: a configured LLM is assumed healthy unless a real request
// has actually failed. So only `failing` shows red — everything else configured
// is green (DEU-176).
function dotClass(configured: boolean, llmHealth: LlmHealthStatus | null): string {
  if (!configured || llmHealth?.state === 'not_configured') return 'bg-muted-foreground/40'
  if (llmHealth?.state === 'waiting_for_config') return 'bg-muted-foreground/40'
  if (llmHealth?.state === 'failing') return 'bg-destructive'
  return 'bg-emerald-500'
}

function stateLabel(configured: boolean, llmHealth: LlmHealthStatus | null): string {
  if (!configured || llmHealth?.state === 'not_configured') return 'Not configured'
  if (llmHealth?.state === 'waiting_for_config') return 'Waiting for model config'
  if (llmHealth?.state === 'failing') return 'Failing'
  return 'Connected'
}

export function LlmStatusPanel({
  vendor,
  llmHealth,
  configured,
  collapsed = false,
  onClick,
}: LlmStatusPanelProps): React.JSX.Element {
  const state = stateLabel(configured, llmHealth)
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`LLM ${state} — open AI Models settings`}
        title={`${VENDOR_LABELS[vendor]} · ${state}`}
        className={cn(
          'flex items-center justify-center w-full h-9 rounded-md',
          'hover:bg-sidebar-accent/70 transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        )}
      >
        <span className={cn('h-2.5 w-2.5 rounded-full', dotClass(configured, llmHealth))} />
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 w-full text-left px-3 h-9 rounded-lg',
        'border border-sidebar-border bg-sidebar-accent/40',
        'hover:bg-sidebar-accent/70 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
      )}
      aria-label="LLM status — open AI Models settings"
    >
      <span className={cn('h-2 w-2 shrink-0 rounded-full', dotClass(configured, llmHealth))} />
      <span className="text-xs text-sidebar-foreground/80">{VENDOR_LABELS[vendor]}</span>
      <span className="ml-auto text-xs text-sidebar-foreground/60">{state}</span>
    </button>
  )
}
