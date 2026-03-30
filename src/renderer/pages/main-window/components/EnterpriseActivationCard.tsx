import * as React from 'react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card'
import { Input } from '@components/ui/input'
import type { AccessState, MainWindowAPI } from '@types'

interface EnterpriseActivationCardProps {
  api: MainWindowAPI
  accessState: AccessState | null
}

export function EnterpriseActivationCard({
  api,
  accessState,
}: EnterpriseActivationCardProps): React.JSX.Element {
  const [activationKey, setActivationKey] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleActivate = useCallback(async () => {
    const key = activationKey.trim()
    if (key === '') {
      toast.error('Enter an activation key')
      return
    }

    setSubmitting(true)
    try {
      const result = await api.activateEnterpriseLicense(key)
      if (!result.success) {
        toast.error(result.error ?? 'Activation failed')
        return
      }

      setActivationKey('')
      toast.success('Activation request accepted')
    } finally {
      setSubmitting(false)
    }
  }, [activationKey, api])

  const status = accessState?.enterpriseActivationStatus ?? 'idle'
  const isWaiting = status === 'activating' || status === 'waiting_for_key'

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Activate Device</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Enter your enterprise activation key to provision this device.
        </p>

        {status === 'inactive' && (
          <p className="text-xs text-muted-foreground">This device is not activated yet.</p>
        )}

        {status === 'waiting_for_key' && (
          <p className="text-xs text-muted-foreground">
            Activation succeeded. Waiting for API key provisioning...
          </p>
        )}

        {status === 'error' && accessState?.error && (
          <p className="text-xs text-destructive">{accessState.error}</p>
        )}

        <Input
          type="password"
          placeholder="Activation key"
          autoComplete="off"
          value={activationKey}
          onChange={(e) => setActivationKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void handleActivate()
            }
          }}
        />

        <Button
          className="w-full"
          disabled={submitting || isWaiting}
          onClick={() => void handleActivate()}
        >
          {submitting ? 'Activating...' : isWaiting ? 'Provisioning...' : 'Activate Device'}
        </Button>
      </CardContent>
    </Card>
  )
}
