import * as React from 'react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Eye, EyeSlash } from '@phosphor-icons/react'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Badge } from '@components/ui/badge'
import type { MainWindowAPI, Vendor, VendorStatus } from '@types'

interface ManageKeySectionProps {
  api: MainWindowAPI
  vendor: Vendor
  status: VendorStatus
  onChanged: () => void
}

interface VendorMeta {
  label: string
  keyPrefix: string | null
  keyHint: string
  needsBaseURL: 'no' | 'optional' | 'required'
  defaultBaseURL: string | null
  externalLink?: { href: string; label: string }
}

const VENDOR_META: Record<Vendor, VendorMeta> = {
  openrouter: {
    label: 'OpenRouter',
    keyPrefix: 'sk-or-',
    keyHint: 'sk-or-v1-...',
    needsBaseURL: 'no',
    defaultBaseURL: null,
    externalLink: { href: 'https://openrouter.ai', label: 'OpenRouter' },
  },
  google: {
    label: 'Google Vertex AI',
    keyPrefix: null,
    keyHint: 'Vertex Express API key',
    needsBaseURL: 'no',
    defaultBaseURL: null,
  },
  'openai-compatible': {
    label: 'OpenAI-compatible endpoint',
    keyPrefix: null,
    keyHint: 'api key (optional for some local servers)',
    needsBaseURL: 'required',
    defaultBaseURL: 'http://localhost:11434/v1',
  },
}

function validateApiKey(key: string, prefix: string | null): boolean {
  if (key.length < 6) return false
  if (prefix && !key.startsWith(prefix)) return false
  return true
}

export function ManageKeySection({
  api,
  vendor,
  status,
  onChanged,
}: ManageKeySectionProps): React.JSX.Element {
  const meta = VENDOR_META[vendor]
  const [expanded, setExpanded] = useState(false)
  const [inputKey, setInputKey] = useState('')
  const [inputBaseURL, setInputBaseURL] = useState(status.baseURL ?? meta.defaultBaseURL ?? '')
  const [advancedOpen, setAdvancedOpen] = useState(meta.needsBaseURL === 'required')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isManaged = status.source === 'managed'

  const handleSave = useCallback(async () => {
    const key = inputKey.trim()
    const baseURL = inputBaseURL.trim()
    if (key === '' && vendor !== 'openai-compatible') {
      toast.error('Please enter an API key')
      return
    }
    if (key !== '' && !validateApiKey(key, meta.keyPrefix)) {
      toast.error(
        `Invalid key format${meta.keyPrefix ? ` (should start with ${meta.keyPrefix})` : ''}`,
      )
      return
    }
    if (meta.needsBaseURL === 'required' && baseURL === '') {
      toast.error('Base URL is required for this vendor')
      return
    }

    setSaving(true)
    try {
      const creds: { apiKey: string; baseURL?: string } = { apiKey: key }
      if (meta.needsBaseURL !== 'no' && baseURL.length > 0) creds.baseURL = baseURL
      const result = await api.saveCredentials(vendor, creds)
      if (result.success) {
        setInputKey('')
        setExpanded(false)
        toast.success(`${meta.label} credentials saved`)
        onChanged()
      } else {
        toast.error(result.error ?? 'Failed to save credentials')
      }
    } finally {
      setSaving(false)
    }
  }, [api, inputKey, inputBaseURL, vendor, meta, onChanged])

  const handleDelete = useCallback(async () => {
    setDeleting(true)
    try {
      const result = await api.deleteCredentials(vendor)
      if (result.success) {
        toast.success(`${meta.label} credentials deleted`)
        onChanged()
      } else {
        toast.error(result.error ?? 'Failed to delete credentials')
      }
    } finally {
      setDeleting(false)
    }
  }, [api, vendor, meta.label, onChanged])

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

  const canDelete = status.source === 'stored' || status.source === 'managed'
  const showInput = !status.hasKey || (!isManaged && expanded)
  const showBaseURL =
    meta.needsBaseURL === 'required' || (meta.needsBaseURL === 'optional' && advancedOpen)

  return (
    <div className="space-y-3">
      {status.hasKey && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs">
              {status.maskedKey || 'no key'}
            </Badge>
            {status.source === 'env' && (
              <span className="text-xs text-muted-foreground">(from env)</span>
            )}
            {status.baseURL && (
              <span className="text-xs text-muted-foreground">→ {status.baseURL}</span>
            )}
          </div>
          {isManaged ? (
            <Button variant="ghost" size="sm" onClick={() => void handleManageSubscription()}>
              Manage Subscription
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Cancel' : 'Manage'}
            </Button>
          )}
        </div>
      )}

      {showInput && (
        <div className={`space-y-3 ${status.hasKey ? 'pt-2 border-t' : ''}`}>
          <div className="relative">
            <Input
              type={passwordVisible ? 'text' : 'password'}
              placeholder={meta.keyHint}
              autoComplete="off"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pr-9 font-mono text-sm"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={passwordVisible ? 'Hide key' : 'Show key'}
              onClick={() => setPasswordVisible((v) => !v)}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {passwordVisible ? <EyeSlash /> : <Eye />}
            </Button>
          </div>

          {meta.needsBaseURL === 'optional' && !advancedOpen && (
            <Button type="button" variant="ghost" size="xs" onClick={() => setAdvancedOpen(true)}>
              Advanced: override base URL
            </Button>
          )}

          {showBaseURL && (
            <Input
              type="text"
              placeholder={meta.defaultBaseURL ?? 'https://...'}
              value={inputBaseURL}
              onChange={(e) => setInputBaseURL(e.target.value)}
              className="font-mono text-sm"
            />
          )}

          <div className="flex gap-2">
            <Button
              className="flex-1"
              size="sm"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? 'Saving...' : status.hasKey ? 'Update' : 'Save'}
            </Button>
            {status.hasKey && (
              <Button
                variant="destructive"
                size="sm"
                disabled={!canDelete || deleting}
                onClick={() => void handleDelete()}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </Button>
            )}
          </div>
        </div>
      )}

      {meta.externalLink && (
        <p className="text-xs text-muted-foreground">
          We use{' '}
          <a
            href={meta.externalLink.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            {meta.externalLink.label}
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
      )}
    </div>
  )
}
