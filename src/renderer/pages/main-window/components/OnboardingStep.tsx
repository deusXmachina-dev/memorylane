import * as React from 'react'

interface OnboardingStepProps {
  children: React.ReactNode
}

function OnboardingStepRoot({ children }: OnboardingStepProps): React.JSX.Element {
  return <div className="space-y-6">{children}</div>
}

interface HeaderProps {
  title: string
  subtitle?: React.ReactNode
}

function Header({ title, subtitle }: HeaderProps): React.JSX.Element {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
    </div>
  )
}

export const OnboardingStep = Object.assign(OnboardingStepRoot, { Header })
