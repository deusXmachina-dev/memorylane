import * as React from 'react'
import { ArrowRight, Leaf } from 'lucide-react'
import { cn } from '@/renderer/lib/utils'

interface UpdateBannerProps {
  version: string | null
  onRelaunch: () => void
  collapsed?: boolean
}

export function UpdateBanner({
  version,
  onRelaunch,
  collapsed = false,
}: UpdateBannerProps): React.JSX.Element {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onRelaunch}
        aria-label="Relaunch to update"
        title={version ? `Relaunch to update · v${version}` : 'Relaunch to update'}
        className={cn(
          'flex items-center justify-center w-full h-9 rounded-md',
          'bg-primary/15 text-primary hover:bg-primary/25 transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        )}
      >
        <Leaf className="size-4" />
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onRelaunch}
      aria-label={version ? `Relaunch to update — v${version}` : 'Relaunch to update'}
      className={cn(
        'flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-lg',
        'border border-primary/50 bg-primary/10',
        'hover:bg-primary/15 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
      )}
    >
      <Leaf className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium leading-tight text-sidebar-foreground">
          Relaunch to update
        </span>
        {version ? (
          <span className="block text-[11px] leading-tight text-sidebar-foreground/60">
            v{version}
          </span>
        ) : null}
      </span>
      <ArrowRight className="size-3.5 shrink-0 text-sidebar-foreground/60" aria-hidden />
    </button>
  )
}
