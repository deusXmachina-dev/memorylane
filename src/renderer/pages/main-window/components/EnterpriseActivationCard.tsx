import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card'
import { Input } from '@components/ui/input'
import type { AccessState, ConsentOutcome, MainWindowAPI, PendingConsent } from '@types'

interface EnterpriseActivationCardProps {
  api: MainWindowAPI
  accessState: AccessState | null
}

export function EnterpriseActivationCard({
  api,
  accessState,
}: EnterpriseActivationCardProps): React.JSX.Element {
  const status = accessState?.enterpriseActivationStatus ?? 'idle'

  if (status === 'awaiting_consent') {
    return <ConsentScreen api={api} accessState={accessState} />
  }

  if (status === 'activating' || status === 'waiting_for_key') {
    return <ProvisioningView status={status} />
  }

  return <ActivationKeyEntry api={api} accessState={accessState} />
}

function ProvisioningView({
  status,
}: {
  status: 'activating' | 'waiting_for_key'
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Activate Device</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {status === 'activating'
            ? 'Activating this device...'
            : 'Activation succeeded. Waiting for API key provisioning...'}
        </p>
      </CardContent>
    </Card>
  )
}

function ActivationKeyEntry({
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
    } finally {
      setSubmitting(false)
    }
  }, [activationKey, api])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Activate Device</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Enter your enterprise activation key to provision this device.
        </p>

        {accessState?.error && <p className="text-xs text-destructive">{accessState.error}</p>}

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

        <Button className="w-full" disabled={submitting} onClick={() => void handleActivate()}>
          {submitting ? 'Activating...' : 'Activate Device'}
        </Button>
      </CardContent>
    </Card>
  )
}

function ConsentScreen({ api, accessState }: EnterpriseActivationCardProps): React.JSX.Element {
  const [consent, setConsent] = useState<PendingConsent | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await api.getPendingConsent()
        if (!cancelled) {
          if (result === null) {
            setLoadError('Consent document is no longer available.')
          } else {
            setConsent(result)
          }
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load consent document')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [api])

  const decide = useCallback(
    async (outcome: ConsentOutcome) => {
      setSubmitting(true)
      try {
        const result = await api.submitConsentDecision(outcome)
        if (!result.success) {
          toast.error(result.error ?? 'Consent request failed')
        }
      } finally {
        setSubmitting(false)
      }
    },
    [api],
  )

  const docDataUrl =
    consent !== null && consent.contentType === 'application/pdf'
      ? `data:application/pdf;base64,${consent.bytesBase64}`
      : null

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{consent?.title ?? 'Review and accept'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Your employer needs your consent before activating this device. Review the document below
          before deciding.
        </p>

        {loadError !== null && <p className="text-xs text-destructive">{loadError}</p>}

        {accessState?.error && <p className="text-xs text-destructive">{accessState.error}</p>}

        {docDataUrl !== null ? (
          <iframe
            title="Consent document"
            src={docDataUrl}
            referrerPolicy="no-referrer"
            className="h-96 w-full rounded border border-border bg-background"
          />
        ) : (
          loadError === null && <p className="text-xs text-muted-foreground">Loading document...</p>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            disabled={submitting}
          />
          <span>I have read and agree to this document.</span>
        </label>

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={submitting}
            onClick={() => void decide('declined')}
          >
            Decline
          </Button>
          <Button
            className="flex-1"
            disabled={submitting || !agreed || consent === null}
            onClick={() => void decide('accepted')}
          >
            {submitting ? 'Submitting...' : 'Accept'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
