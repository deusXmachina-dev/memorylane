import * as React from 'react'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/renderer/lib/utils'

export type OnboardingStepId =
  | 'welcome'
  | 'permissions'
  | 'plan'
  | 'activation'
  | 'connect'
  | 'blacklist'
  | 'capture'

export interface OnboardingStepInfo {
  id: OnboardingStepId
  label: string
}

interface OnboardingLayoutProps {
  steps: OnboardingStepInfo[]
  currentStep: OnboardingStepId
  onBack?: () => void
  onForward?: () => void
  canGoBack: boolean
  canGoForward: boolean
  children: React.ReactNode
}

export function OnboardingLayout({
  steps,
  currentStep,
  onBack,
  onForward,
  canGoBack,
  canGoForward,
  children,
}: OnboardingLayoutProps): React.JSX.Element {
  const currentIndex = steps.findIndex((s) => s.id === currentStep)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <NavButton
          direction="back"
          disabled={!canGoBack}
          onClick={canGoBack ? onBack : undefined}
        />
        <ol className="flex flex-1 items-center gap-2">
          {steps.map((step, idx) => {
            const isCurrent = idx === currentIndex
            const isDone = idx < currentIndex
            return (
              <li
                key={step.id}
                className={cn(
                  'flex items-center gap-2 min-w-0',
                  idx < steps.length - 1 && 'flex-1',
                )}
              >
                <div
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium',
                    isCurrent && 'border-primary bg-primary text-primary-foreground',
                    isDone && 'border-primary/60 bg-primary/20 text-primary',
                    !isCurrent && !isDone && 'border-border text-muted-foreground',
                  )}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={step.label}
                >
                  {isDone ? <Check className="size-3.5" strokeWidth={3} /> : idx + 1}
                </div>
                {idx < steps.length - 1 && (
                  <div className={cn('h-px flex-1', isDone ? 'bg-primary/40' : 'bg-border')} />
                )}
              </li>
            )
          })}
        </ol>
        <NavButton
          direction="forward"
          disabled={!canGoForward}
          onClick={canGoForward ? onForward : undefined}
        />
      </div>
      <div>{children}</div>
    </div>
  )
}

interface NavButtonProps {
  direction: 'back' | 'forward'
  disabled: boolean
  onClick?: () => void
}

function NavButton({ direction, disabled, onClick }: NavButtonProps): React.JSX.Element {
  const Icon = direction === 'back' ? ChevronLeft : ChevronRight
  const label = direction === 'back' ? 'Previous step' : 'Next step'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground',
        'hover:bg-accent hover:text-foreground',
        'disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground',
        'transition-colors',
      )}
    >
      <Icon className="size-4" />
    </button>
  )
}
