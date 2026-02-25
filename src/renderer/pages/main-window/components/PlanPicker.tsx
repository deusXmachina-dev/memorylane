import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card'
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
    id: 'standard',
    name: 'Standard',
    price: '$10/mo',
    features: ['Screen capture', 'AI summaries', 'Local search'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$100/mo',
    highlighted: true,
    features: ['Everything in Standard', 'Task mining', 'Pattern detection'],
  },
]

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
    <Card className={`flex-1 ${plan.highlighted ? 'border-primary' : ''}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">{plan.name}</CardTitle>
        </div>
        <p className="text-lg font-semibold">{plan.price}</p>
      </CardHeader>
      <CardContent className="space-y-3">
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

interface PlanPickerProps {
  api: MainWindowAPI
  onKeySet: () => void
}

export function PlanPicker({ api, onKeySet }: PlanPickerProps): React.JSX.Element {
  const [status, setStatus] = useState<SubscriptionStatus>('idle')
  const statusRef = useRef(status)
  statusRef.current = status

  useEffect(() => {
    void api.getSubscriptionStatus().then((s) => {
      setStatus(s)
      statusRef.current = s
    })

    api.onSubscriptionUpdate((update) => {
      if (update.status === 'idle' && statusRef.current !== 'idle') {
        toast.success('API key provisioned successfully')
        onKeySet()
      }

      if (update.status === 'error' && update.error) {
        toast.error(update.error)
      }

      setStatus(update.status)
      statusRef.current = update.status
    })
  }, [api, onKeySet])

  return (
    <div className="space-y-3">
      <div className="text-center">
        <p className="text-sm text-muted-foreground">
          Choose a plan to get started. You&apos;ll be redirected to Stripe.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} api={api} status={status} />
        ))}
      </div>
    </div>
  )
}
