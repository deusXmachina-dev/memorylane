import * as React from 'react'
import { Button } from '@components/ui/button'
import { OnboardingStep } from './OnboardingStep'

interface WelcomeStepProps {
  onContinue: () => void
}

const POINTS = [
  {
    title: 'Spots the busywork',
    body: 'MemoryLane watches what you do and surfaces tasks worth automating — without you having to write anything down.',
  },
  {
    title: 'Stays on your device',
    body: 'Captures and patterns live locally. Nothing leaves your machine unless you ship it somewhere yourself.',
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

      <div className="pt-2">
        <Button size="lg" onClick={onContinue}>
          Get started
        </Button>
      </div>
    </OnboardingStep>
  )
}
