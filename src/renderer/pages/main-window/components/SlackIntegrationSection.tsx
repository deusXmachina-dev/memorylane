import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import type { MainWindowAPI, SlackIntegrationConfig, SlackIntegrationStatus } from '@types'

interface SlackIntegrationSectionProps {
  api: MainWindowAPI
  status: SlackIntegrationStatus
  onChanged: () => void
}

function FieldBlock({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  )
}

export function SlackIntegrationSection({
  api,
  status,
  onChanged,
}: SlackIntegrationSectionProps): React.JSX.Element {
  const [form, setForm] = useState<SlackIntegrationConfig>({
    enabled: status.enabled,
    ownerUserId: status.ownerUserId,
    watchedChannelIds: status.watchedChannelIds,
    pollIntervalMs: status.pollIntervalMs,
    allwaysApprove: status.allwaysApprove,
    botToken: '',
  })
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [showToken, setShowToken] = useState(false)

  useEffect(() => {
    setForm({
      enabled: status.enabled,
      ownerUserId: status.ownerUserId,
      watchedChannelIds: status.watchedChannelIds,
      pollIntervalMs: status.pollIntervalMs,
      allwaysApprove: status.allwaysApprove,
      botToken: '',
    })
  }, [status])

  const update = <K extends keyof SlackIntegrationConfig>(
    key: K,
    value: SlackIntegrationConfig[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const result = await api.saveSlackSettings({
        ...form,
        botToken: form.botToken?.trim() || undefined,
      })

      if (!result.success) {
        toast.error(result.error ?? 'Failed to save Slack settings')
        return
      }

      toast.success(form.enabled ? 'Slack integration updated' : 'Slack integration saved')
      onChanged()
    } finally {
      setSaving(false)
    }
  }, [api, form, onChanged])

  const handleSetEnabled = useCallback(
    async (enabled: boolean) => {
      const nextForm = { ...form, enabled }
      setForm(nextForm)
      setSaving(true)
      try {
        const result = await api.saveSlackSettings({
          ...nextForm,
          botToken: nextForm.botToken?.trim() || undefined,
        })

        if (!result.success) {
          setForm(form)
          toast.error(result.error ?? 'Failed to update Slack integration state')
          return
        }

        toast.success(enabled ? 'Slack integration started' : 'Slack integration stopped')
        onChanged()
      } finally {
        setSaving(false)
      }
    },
    [api, form, onChanged],
  )

  const handleReset = useCallback(async () => {
    setResetting(true)
    try {
      const result = await api.resetSlackSettings()
      if (!result.success) {
        toast.error(result.error ?? 'Failed to reset Slack settings')
        return
      }

      toast.success('Slack settings reset')
      onChanged()
    } finally {
      setResetting(false)
    }
  }, [api, onChanged])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <Badge variant={status.running ? 'default' : 'outline'}>
          {status.running ? 'Running' : status.enabled ? 'Configured' : 'Disabled'}
        </Badge>
        {status.hasBotToken && (
          <Badge variant="outline" className="font-mono text-xs">
            {status.maskedBotToken}
          </Badge>
        )}
        {status.lastError && <Badge variant="outline">Error</Badge>}
      </div>

      {status.lastError && <p className="text-xs text-destructive">{status.lastError}</p>}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">Enable Slack integration</p>
        <div className="grid shrink-0 grid-cols-2 gap-2">
          <Button
            variant={form.enabled ? 'default' : 'outline'}
            size="sm"
            disabled={saving}
            onClick={() => void handleSetEnabled(true)}
          >
            On
          </Button>
          <Button
            variant={!form.enabled ? 'default' : 'outline'}
            size="sm"
            disabled={saving}
            onClick={() => void handleSetEnabled(false)}
          >
            Off
          </Button>
        </div>
      </div>

      <FieldBlock label="Bot Token">
        <Input
          type={showToken ? 'text' : 'password'}
          autoComplete="off"
          placeholder="xoxb-..."
          value={form.botToken ?? ''}
          onChange={(event) => update('botToken', event.target.value)}
          className="font-mono text-sm"
        />
        <div className="flex justify-end">
          <Button variant="ghost" size="xs" onClick={() => setShowToken((value) => !value)}>
            {showToken ? 'Hide token' : 'Show token'}
          </Button>
        </div>
      </FieldBlock>

      <FieldBlock label="Owner User ID">
        <Input
          type="text"
          placeholder="U0123456789"
          value={form.ownerUserId}
          onChange={(event) => update('ownerUserId', event.target.value)}
          className="font-mono text-sm"
        />
      </FieldBlock>

      <FieldBlock label="Watched Channels">
        <Input
          type="text"
          placeholder="C0123456789, C9876543210"
          value={form.watchedChannelIds}
          onChange={(event) => update('watchedChannelIds', event.target.value)}
          className="font-mono text-sm"
        />
      </FieldBlock>

      <FieldBlock label="Poll Interval (Seconds)">
        <Input
          type="number"
          min={10}
          step={1}
          placeholder="30"
          value={String(Math.round(form.pollIntervalMs / 1000))}
          onChange={(event) =>
            update('pollIntervalMs', (Number.parseInt(event.target.value, 10) || 0) * 1000)
          }
          className="font-mono text-sm"
        />
      </FieldBlock>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">Auto-approve replies</p>
        <div className="grid shrink-0 grid-cols-2 gap-2">
          <Button
            variant={form.allwaysApprove ? 'default' : 'outline'}
            size="sm"
            onClick={() => update('allwaysApprove', true)}
          >
            On
          </Button>
          <Button
            variant={!form.allwaysApprove ? 'default' : 'outline'}
            size="sm"
            onClick={() => update('allwaysApprove', false)}
          >
            Off
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <Button className="flex-1" size="sm" disabled={saving} onClick={() => void handleSave()}>
          {saving ? 'Saving...' : 'Save Slack Settings'}
        </Button>
        <Button variant="ghost" size="sm" disabled={resetting} onClick={() => void handleReset()}>
          {resetting ? 'Resetting...' : 'Reset'}
        </Button>
      </div>
    </div>
  )
}
