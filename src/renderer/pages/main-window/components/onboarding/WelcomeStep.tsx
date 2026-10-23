import * as React from 'react'
import { OnboardingStep } from './OnboardingStep'

interface WelcomeStepProps {
  onContinue: () => void
}

const POINTS = [
  {
    title: 'Spots the busywork',
    body: 'MemoryLane watches what you do and surfaces tasks worth automating, without you having to write anything down.',
  },
  {
    title: 'Stored on your device',
    body: 'Your history and patterns live locally. Screenshots are summarized by AI (zero data retention on our plan), then deleted.',
  },
  {
    title: 'Works with your AI assistant',
    body: 'Hand the patterns to Claude or any MCP-compatible assistant and let it do the boring parts for you.',
  },
]

export function WelcomeStep({ onContinue }: WelcomeStepProps): React.JSX.Element {
  return (
    <OnboardingStep>
      <OnboardingStep.Header
        title="Welcome to MemoryLane"
        subtitle="A quick setup before you start capturing."
      />

      <ul className="space-y-4">
        {POINTS.map((p) => (
          <li key={p.title} className="flex gap-3">
            <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{p.title}</p>
              <p className="text-sm text-muted-foreground">{p.body}</p>
            </div>
          </li>
        ))}
      </ul>

      <OnboardingStep.Button onClick={onContinue}>Get started</OnboardingStep.Button>
    </OnboardingStep>
  )
}
