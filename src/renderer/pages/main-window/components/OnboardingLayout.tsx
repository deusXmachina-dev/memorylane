import * as React from 'react'
import { cn } from '@/renderer/lib/utils'

export type OnboardingStepId =
  | 'welcome'
  | 'permissions'
  | 'plan'
  | 'activation'
  | 'connect'
  | 'capture'

export interface OnboardingStepInfo {
  id: OnboardingStepId
  label: string
}

interface OnboardingLayoutProps {
  steps: OnboardingStepInfo[]
  currentStep: OnboardingStepId
  children: React.ReactNode
}

export function OnboardingLayout({
  steps,
  currentStep,
  children,
}: OnboardingLayoutProps): React.JSX.Element {
  const currentIndex = steps.findIndex((s) => s.id === currentStep)

  return (
    <div className="space-y-6">
      <div className="flex items-center">
        <ol className="flex flex-1 items-center gap-2">
          {steps.map((step, idx) => {
            const isCurrent = idx === currentIndex
            const isDone = idx < currentIndex
            return (
              <li key={step.id} className="flex flex-1 items-center gap-2 min-w-0">
                <div
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium',
                    isCurrent && 'border-primary bg-primary text-primary-foreground',
                    isDone && 'border-primary/60 bg-primary/20 text-primary',
                    !isCurrent && !isDone && 'border-border text-muted-foreground',
                  )}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {isDone ? (
                    <svg
                      className="size-3"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  ) : (
                    idx + 1
                  )}
                </div>
                <span
                  className={cn(
                    'truncate text-xs',
                    isCurrent ? 'text-foreground font-medium' : 'text-muted-foreground',
                  )}
                >
                  {step.label}
                </span>
                {idx < steps.length - 1 && (
                  <div className={cn('h-px flex-1', isDone ? 'bg-primary/40' : 'bg-border')} />
                )}
              </li>
            )
          })}
        </ol>
      </div>
      <div>{children}</div>
    </div>
  )
}
