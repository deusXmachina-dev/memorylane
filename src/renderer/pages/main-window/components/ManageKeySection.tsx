import * as React from 'react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Badge } from '@components/ui/badge'
import type { KeyStatus, MainWindowAPI } from '@types'

interface ManageKeySectionProps {
  api: MainWindowAPI
  keyStatus: KeyStatus
  onKeyDeleted: () => void
  onKeyUpdated: () => void
}

function validateApiKey(key: string): boolean {
  return key.startsWith('sk-or-') && key.length > 10
}

export function ManageKeySection({
  api,
  keyStatus,
  onKeyDeleted,
  onKeyUpdated,
}: ManageKeySectionProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isManaged = keyStatus.source === 'managed'

  const handleSave = useCallback(async () => {
    const key = inputValue.trim()
    if (key === '') {
      toast.error('Please enter an API key')
      return
    }
    if (!validateApiKey(key)) {
      toast.error('Invalid API key format (should start with sk-or-)')
      return
    }

    setSaving(true)
    try {
      const result = await api.saveApiKey(key)
      if (result.success) {
        setInputValue('')
        setExpanded(false)
        toast.success('API key updated successfully')
        onKeyUpdated()
      } else {
        toast.error(result.error ?? 'Failed to save API key')
      }
    } finally {
      setSaving(false)
    }
  }, [api, inputValue, onKeyUpdated])

  const handleDelete = useCallback(async () => {
    setDeleting(true)
    try {
      const result = await api.deleteApiKey()
      if (result.success) {
        toast.success('API key deleted')
        onKeyDeleted()
      } else {
        toast.error(result.error ?? 'Failed to delete API key')
      }
    } finally {
      setDeleting(false)
    }
  }, [api, onKeyDeleted])

  const handleManageSubscription = useCallback(async () => {
    try {
      await api.openSubscriptionPortal()
    } catch {
      toast.error('Failed to open subscription portal')
    }
  }, [api])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        void handleSave()
      }
    },
    [handleSave],
  )

  const canDelete = keyStatus.source === 'stored' || keyStatus.source === 'managed'
  const showInput = !keyStatus.hasKey || (!isManaged && expanded)

  return (
    <div className="space-y-3">
      {keyStatus.hasKey && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs">
              {keyStatus.maskedKey}
            </Badge>
            {keyStatus.source === 'env' && (
              <span className="text-xs text-muted-foreground">(from env)</span>
            )}
          </div>
          {isManaged ? (
            <Button variant="ghost" size="sm" onClick={() => void handleManageSubscription()}>
              Manage Subscription
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Cancel' : 'Manage Key'}
            </Button>
          )}
        </div>
      )}

      {showInput && (
        <div className={`space-y-3 ${keyStatus.hasKey ? 'pt-2 border-t' : ''}`}>
          <div className="relative">
            <Input
              type={passwordVisible ? 'text' : 'password'}
              placeholder={keyStatus.hasKey ? 'Enter new key to replace...' : 'sk-or-v1-...'}
              autoComplete="off"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pr-16 font-mono text-sm"
            />
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setPasswordVisible((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2"
            >
              {passwordVisible ? 'Hide' : 'Show'}
            </Button>
          </div>

          <div className="flex gap-2">
            <Button
              className="flex-1"
              size="sm"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? 'Saving...' : keyStatus.hasKey ? 'Update Key' : 'Save Key'}
            </Button>
            {keyStatus.hasKey && (
              <Button
                variant="destructive"
                size="sm"
                disabled={!canDelete || deleting}
                onClick={() => void handleDelete()}
              >
                {deleting ? 'Deleting...' : 'Delete Key'}
              </Button>
            )}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        We use{' '}
        <a
          href="https://openrouter.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          OpenRouter
        </a>{' '}
        because they are transparent about{' '}
        <a
          href="https://openrouter.ai/models?order=newest&supported_parameters=reasoning&fmt=free%2Cfixed%2Cinput%2Coutput&policies=ZDR"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          Zero Data Retention
        </a>{' '}
        policies. Your key is encrypted and stored locally.
      </p>
    </div>
  )
}
