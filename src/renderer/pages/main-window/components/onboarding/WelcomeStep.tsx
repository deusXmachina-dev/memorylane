import * as React from 'react'
import { OnboardingStep } from './OnboardingStep'

interface WelcomeStepProps {
  isEnterprise: boolean
  onContinue: () => void
}

const pointsFor = (isEnterprise: boolean) => [
  {
    title: 'Spots the busywork',
    body: 'MemoryLane watches what you do and surfaces tasks worth automating, without you having to write anything down.',
  },
  isEnterprise
    ? {
        title: 'Shared with your organization',
        body: 'Your history and patterns are stored on your device and uploaded daily to your organization. Screenshots are summarized by AI, then deleted.',
      }
    : {
        title: 'Stored on your device',
        body: 'Your history and patterns live locally. Screenshots are summarized by AI (zero data retention on our plan), then deleted.',
      },
  {
    title: 'Works with your AI assistant',
    body: 'Hand the patterns to Claude or any MCP-compatible assistant and let it do the boring parts for you.',
  },
]

export function WelcomeStep({ isEnterprise, onContinue }: WelcomeStepProps): React.JSX.Element {
  return (
    <OnboardingStep>
      <OnboardingStep.Header
        title="Welcome to MemoryLane"
        subtitle="A quick setup before you start capturing."
      />

      <ul className="space-y-4">
        {pointsFor(isEnterprise).map((p) => (
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
