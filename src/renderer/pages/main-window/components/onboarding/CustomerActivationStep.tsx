import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card'
import { OnboardingStep } from './OnboardingStep'
import type { MainWindowAPI, SubscriptionPlan, SubscriptionStatus } from '@types'

export interface PlanConfig {
  id: SubscriptionPlan
  name: string
  price: string
  features: string[]
  highlighted?: boolean
}

export const PLANS: PlanConfig[] = [
  {
    id: 'explorer',
    name: 'Explorer',
    price: '$50/mo',
    highlighted: true,
    features: ['Automation recommendations', 'No API keys needed', 'Data stored on your device'],
  },
]

const ENTERPRISE = {
  name: 'Enterprise',
  price: 'Custom',
  features: ['Custom integrations', 'Done-for-you setup', 'Dedicated support'],
}

const BOOK_CALL_URL = 'https://calendar.app.google/2rJgu2Ah3kWaMApG8'

interface PlanCardProps {
  plan: PlanConfig
  api: MainWindowAPI
  status: SubscriptionStatus
}

function PlanCard({ plan, api, status }: PlanCardProps): React.JSX.Element {
  const isLoading = status === 'polling' || status === 'awaiting_checkout'

  const handleSubscribe = useCallback(async () => {
    try {
      await api.startCheckout(plan.id)
    } catch {
      toast.error('Failed to open checkout')
    }
  }, [api, plan.id])

  return (
    <Card className={`flex-1 ${plan.highlighted ? 'border-primary ring-1 ring-primary/40' : ''}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{plan.name}</CardTitle>
          {plan.highlighted && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
              Recommended
            </span>
          )}
        </div>
        <p className="text-2xl font-semibold">{plan.price}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-1.5">
          {plan.features.map((f) => (
            <li key={f} className="text-xs text-muted-foreground flex items-start gap-1.5">
              <span className="text-foreground mt-px">&#10003;</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-3 text-center">
            <div className="w-6 h-6 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin mb-2" />
            <p className="text-xs text-muted-foreground">
              {status === 'awaiting_checkout' ? 'Opening checkout...' : 'Waiting for payment...'}
            </p>
          </div>
        ) : (
          <Button
            className="w-full"
            variant={plan.highlighted ? 'default' : 'outline'}
            onClick={() => void handleSubscribe()}
          >
            Subscribe
          </Button>
        )}

        {status === 'error' && (
          <p className="text-xs text-destructive text-center">Something went wrong. Try again.</p>
        )}
      </CardContent>
    </Card>
  )
}

function EnterpriseCard(): React.JSX.Element {
  const handleBookCall = useCallback(() => {
    window.open(BOOK_CALL_URL, '_blank')
  }, [])

  return (
    <Card className="flex-1">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{ENTERPRISE.name}</CardTitle>
        <p className="text-2xl font-semibold">{ENTERPRISE.price}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-1.5">
          {ENTERPRISE.features.map((f) => (
            <li key={f} className="text-xs text-muted-foreground flex items-start gap-1.5">
              <span className="text-foreground mt-px">&#10003;</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
        <Button className="w-full" variant="outline" onClick={handleBookCall}>
          Book a call
        </Button>
      </CardContent>
    </Card>
  )
}

interface CustomerActivationStepProps {
  api: MainWindowAPI
  onKeySet: () => void
  onUseOwnEndpoint: () => void
  isConfigured: boolean
  onContinue: () => void
}

export function CustomerActivationStep({
  api,
  onKeySet,
  onUseOwnEndpoint,
  isConfigured,
  onContinue,
}: CustomerActivationStepProps): React.JSX.Element {
  const [status, setStatus] = useState<SubscriptionStatus>('idle')
  const statusRef = useRef(status)
  statusRef.current = status

  useEffect(() => {
    void api.getSubscriptionStatus().then((s) => {
      setStatus(s)
      statusRef.current = s
    })

    const unsubscribe = api.onSubscriptionUpdate((update) => {
      if (update.status === 'idle' && statusRef.current === 'polling') {
        toast.success('API key provisioned successfully')
        onKeySet()
      }

      if (update.status === 'error' && update.error) {
        toast.error(update.error)
      }

      setStatus(update.status)
      statusRef.current = update.status
    })
    return () => unsubscribe()
  }, [api, onKeySet])

  return (
    <OnboardingStep>
      <OnboardingStep.Header
        title="Pick a plan"
        subtitle="Same captures, different support level. You can change later."
      />

      <div className="grid grid-cols-2 gap-4">
        {PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} api={api} status={status} />
        ))}
        <EnterpriseCard />
      </div>

      <p className="text-xs text-muted-foreground">
        Have your own endpoint?{' '}
        <button
          type="button"
          onClick={onUseOwnEndpoint}
          className="text-foreground underline-offset-2 hover:underline"
        >
          Use your own API key in settings
        </button>
        .
      </p>

      <OnboardingStep.Button disabled={!isConfigured} onClick={onContinue}>
        Continue
      </OnboardingStep.Button>
    </OnboardingStep>
  )
}
