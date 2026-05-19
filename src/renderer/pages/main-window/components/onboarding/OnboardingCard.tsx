import * as React from 'react'
import { cn } from '@/renderer/lib/utils'

type Tone = 'default' | 'accent' | 'success'

interface OnboardingCardProps {
  icon: React.ReactNode
  title: React.ReactNode
  description: React.ReactNode
  action?: React.ReactNode
  tone?: Tone
  onClick?: () => void
  disabled?: boolean
  className?: string
}

export function OnboardingCard({
  icon,
  title,
  description,
  action,
  tone = 'default',
  onClick,
  disabled = false,
  className,
}: OnboardingCardProps): React.JSX.Element {
  const interactive = onClick !== undefined && !disabled

  const containerClass = cn(
    'flex w-full items-center gap-4 rounded-lg border bg-card p-4 text-left transition-colors',
    tone === 'accent' && 'border-primary/60 bg-primary/10',
    tone === 'success' && 'border-primary/40',
    tone === 'default' && 'border-border',
    interactive && 'cursor-pointer hover:bg-accent',
    disabled && 'opacity-60',
    className,
  )

  const iconClass = cn(
    'flex size-9 shrink-0 items-center justify-center rounded-full',
    tone === 'default' ? 'bg-muted text-muted-foreground' : 'bg-primary/20 text-primary',
  )

  const content = (
    <>
      <div className={iconClass} aria-hidden>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-tight">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground leading-snug">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={containerClass}>
        {content}
      </button>
    )
  }

  return <div className={containerClass}>{content}</div>
}
