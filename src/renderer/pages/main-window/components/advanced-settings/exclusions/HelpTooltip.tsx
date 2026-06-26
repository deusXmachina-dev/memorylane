import { HelpCircle } from 'lucide-react'

interface HelpTooltipProps {
  /** Accessible label for the trigger (the tooltip body is shown on hover/focus). */
  label: string
  /** Tailwind width class for the popover; written literally so it's scannable. */
  width?: 'w-64' | 'w-72'
  children: React.ReactNode
}

/** A help (?) icon that reveals a small popover on hover/focus. */
export function HelpTooltip({
  label,
  width = 'w-64',
  children,
}: HelpTooltipProps): React.JSX.Element {
  return (
    <span
      tabIndex={0}
      role="button"
      aria-label={label}
      className="group relative inline-flex rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <HelpCircle aria-hidden="true" className="size-3.5 cursor-help text-muted-foreground" />
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full left-0 z-10 mt-1 ${width} rounded-md border border-border bg-popover px-2.5 py-2 text-[11px] leading-snug text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100`}
      >
        {children}
      </span>
    </span>
  )
}
