import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card'
import type { MainWindowAPI, SubscriptionStatus } from '@types'

interface SubscribeColumnProps {
  api: MainWindowAPI
  onKeySet: () => void
}

export function SubscribeColumn({ api, onKeySet }: SubscribeColumnProps): React.JSX.Element {
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

  const handleSubscribe = useCallback(async () => {
    try {
      await api.startCheckout()
    } catch {
      toast.error('Failed to open checkout')
    }
  }, [api])

  if (status === 'polling' || status === 'awaiting_checkout') {
    return (
      <Card className="flex-1">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Subscribe</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <div className="w-8 h-8 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              {status === 'awaiting_checkout' ? 'Opening checkout...' : 'Waiting for payment...'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Complete payment in your browser</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="flex-1">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Subscribe</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center h-8">
          <p className="text-sm text-muted-foreground">
            Get a managed API key for <span className="font-semibold text-foreground">$10/mo</span>.
            No setup required.
          </p>
        </div>

        <Button className="w-full" onClick={() => void handleSubscribe()}>
          Subscribe
        </Button>

        {status === 'error' && (
          <p className="text-xs text-destructive text-center">
            Something went wrong. Please try again.
          </p>
        )}

        <p className="text-xs text-muted-foreground text-center">
          You&apos;ll be redirected to Stripe to complete payment.
        </p>
      </CardContent>
    </Card>
  )
}
