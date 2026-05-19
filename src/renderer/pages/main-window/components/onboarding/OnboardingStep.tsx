import * as React from 'react'
import { Button } from '@components/ui/button'

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

interface StepButtonProps {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}

function StepButton({ onClick, disabled, children }: StepButtonProps): React.JSX.Element {
  return (
    <div className="pt-2">
      <Button size="lg" disabled={disabled} onClick={onClick}>
        {children}
      </Button>
    </div>
  )
}

export const OnboardingStep = Object.assign(OnboardingStepRoot, { Header, Button: StepButton })
