import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { OnboardingStep } from './OnboardingStep'
import type { AccessState, ConsentOutcome, MainWindowAPI, PendingConsent } from '@types'

interface EnterpriseActivationStepProps {
  api: MainWindowAPI
  accessState: AccessState | null
}

export function EnterpriseActivationStep({
  api,
  accessState,
}: EnterpriseActivationStepProps): React.JSX.Element {
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
    <OnboardingStep>
      <OnboardingStep.Header
        title="Activate device"
        subtitle={
          status === 'activating'
            ? 'Activating this device...'
            : 'Activation succeeded. Waiting for API key provisioning...'
        }
      />
    </OnboardingStep>
  )
}

function ActivationKeyEntry({
  api,
  accessState,
}: EnterpriseActivationStepProps): React.JSX.Element {
  const [activationCode, setActivationCode] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleActivate = useCallback(async () => {
    const code = activationCode.trim()
    if (code === '') {
      toast.error('Enter an activation code')
      return
    }

    setSubmitting(true)
    try {
      const result = await api.activateEnterpriseLicense(code)
      if (!result.success) {
        toast.error(result.error ?? 'Activation failed')
        return
      }
      setActivationCode('')
    } finally {
      setSubmitting(false)
    }
  }, [activationCode, api])

  return (
    <OnboardingStep>
      <OnboardingStep.Header
        title="Activate device"
        subtitle="Enter the activation code from your activation email."
      />

      {accessState?.error && <p className="text-xs text-destructive">{accessState.error}</p>}

      <Input
        type="password"
        placeholder="Activation code"
        autoComplete="off"
        value={activationCode}
        onChange={(e) => setActivationCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            void handleActivate()
          }
        }}
      />

      <OnboardingStep.Button disabled={submitting} onClick={() => void handleActivate()}>
        {submitting ? 'Activating...' : 'Activate device'}
      </OnboardingStep.Button>
    </OnboardingStep>
  )
}

function ConsentScreen({ api, accessState }: EnterpriseActivationStepProps): React.JSX.Element {
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
    <OnboardingStep>
      <OnboardingStep.Header
        title={consent?.title ?? 'Review and accept'}
        subtitle="Your employer needs your consent before activating this device. Review the document below before deciding."
      />

      {loadError !== null && <p className="text-xs text-destructive">{loadError}</p>}

      {accessState?.error && <p className="text-xs text-destructive">{accessState.error}</p>}

      {docDataUrl !== null ? (
        <iframe
          title="Consent document"
          src={docDataUrl}
          referrerPolicy="no-referrer"
          className="h-96 w-full rounded-lg border border-border bg-background"
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

      <div className="flex gap-2 pt-2">
        <Button
          size="lg"
          variant="outline"
          className="flex-1"
          disabled={submitting}
          onClick={() => void decide('declined')}
        >
          Decline
        </Button>
        <Button
          size="lg"
          className="flex-1"
          disabled={submitting || !agreed || consent === null}
          onClick={() => void decide('accepted')}
        >
          {submitting ? 'Submitting...' : 'Accept'}
        </Button>
      </div>
    </OnboardingStep>
  )
}
