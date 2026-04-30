import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Badge } from '@components/ui/badge'
import type {
  MainWindowAPI,
  ProviderConfigInput,
  ProviderKind,
  ProviderStatus,
  ProvidersSnapshot,
} from '@types'

const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  'openai-compatible': 'OpenAI-compatible',
}

const KIND_ORDER: ProviderKind[] = ['openrouter', 'openai', 'anthropic', 'openai-compatible']

interface ProvidersSectionProps {
  api: MainWindowAPI
}

interface FormState {
  kind: ProviderKind
  name: string
  baseURL: string
  apiKey: string
  defaultModel: string
}

const EMPTY_FORM: FormState = {
  kind: 'openrouter',
  name: '',
  baseURL: '',
  apiKey: '',
  defaultModel: '',
}

function defaultNameForKind(kind: ProviderKind): string {
  return PROVIDER_KIND_LABELS[kind]
}

function baseURLRequired(kind: ProviderKind): boolean {
  return kind === 'openai-compatible'
}

function baseURLPlaceholder(kind: ProviderKind): string {
  switch (kind) {
    case 'openrouter':
      return 'https://openrouter.ai/api/v1 (optional)'
    case 'openai':
      return 'https://api.openai.com/v1 (optional)'
    case 'anthropic':
      return 'https://api.anthropic.com/v1 (optional)'
    case 'openai-compatible':
      return 'http://localhost:11434/v1'
  }
}

function validateURL(url: string): boolean {
  if (!url) return true
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

export function ProvidersSection({ api }: ProvidersSectionProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<ProvidersSnapshot>({
    providers: [],
    activeProviderId: null,
  })
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const next = await api.listProviders()
    setSnapshot(next)
    setLoading(false)
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const startAdd = useCallback(() => {
    setForm({ ...EMPTY_FORM, name: defaultNameForKind('openrouter') })
    setAdding(true)
  }, [])

  const cancelAdd = useCallback(() => {
    setAdding(false)
    setForm(EMPTY_FORM)
  }, [])

  const onKindChange = useCallback((kind: ProviderKind) => {
    setForm((f) => ({
      ...f,
      kind,
      name: f.name && f.name !== defaultNameForKind(f.kind) ? f.name : defaultNameForKind(kind),
    }))
  }, [])

  const handleSave = useCallback(async () => {
    const name = form.name.trim() || defaultNameForKind(form.kind)
    const baseURL = form.baseURL.trim()
    const apiKey = form.apiKey.trim()
    const defaultModel = form.defaultModel.trim()

    if (baseURLRequired(form.kind) && !baseURL) {
      toast.error('A base URL is required for OpenAI-compatible providers')
      return
    }
    if (baseURL && !validateURL(baseURL)) {
      toast.error('Invalid base URL')
      return
    }
    if (!apiKey) {
      toast.error('API key is required')
      return
    }

    const input: ProviderConfigInput = {
      kind: form.kind,
      name,
      apiKey,
      baseURL: baseURL || undefined,
      defaultModel: defaultModel || undefined,
    }

    setSaving(true)
    try {
      const result = await api.addProvider(input)
      if (!result.success) {
        toast.error(result.error ?? 'Failed to add provider')
        return
      }
      toast.success(`Connected ${name}`)
      setForm(EMPTY_FORM)
      setAdding(false)
      await refresh()
    } finally {
      setSaving(false)
    }
  }, [api, form, refresh])

  const handleSetActive = useCallback(
    async (id: string) => {
      setBusyId(id)
      try {
        const result = await api.setActiveProvider(id)
        if (!result.success) {
          toast.error(result.error ?? 'Failed to set active provider')
          return
        }
        await refresh()
      } finally {
        setBusyId(null)
      }
    },
    [api, refresh],
  )

  const handleRemove = useCallback(
    async (provider: ProviderStatus) => {
      setBusyId(provider.id)
      try {
        const result = await api.removeProvider(provider.id)
        if (!result.success) {
          toast.error(result.error ?? 'Failed to remove provider')
          return
        }
        toast.success(`Removed ${provider.name}`)
        await refresh()
      } finally {
        setBusyId(null)
      }
    },
    [api, refresh],
  )

  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading providers...</p>
  }

  return (
    <div className="space-y-3">
      {snapshot.providers.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground">
          No providers connected. Add one to use semantic capture, pattern detection, or user
          context.
        </p>
      )}

      {snapshot.providers.length > 0 && (
        <div className="space-y-2">
          {snapshot.providers.map((p) => {
            const isActive = p.id === snapshot.activeProviderId
            return (
              <div key={p.id} className="rounded-md border border-border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{p.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {PROVIDER_KIND_LABELS[p.kind]}
                      </Badge>
                      {isActive && (
                        <Badge variant="default" className="text-xs">
                          Active
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                      {p.baseURL && <span className="font-mono break-all">{p.baseURL}</span>}
                      {p.defaultModel && (
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {p.defaultModel}
                        </Badge>
                      )}
                      {p.maskedApiKey && (
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {p.maskedApiKey}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  {!isActive && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === p.id}
                      onClick={() => void handleSetActive(p.id)}
                    >
                      Set active
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === p.id}
                    onClick={() => void handleRemove(p)}
                  >
                    {busyId === p.id ? 'Removing...' : 'Remove'}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {adding ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="flex flex-wrap gap-1.5">
            {KIND_ORDER.map((kind) => (
              <Button
                key={kind}
                size="sm"
                variant={form.kind === kind ? 'default' : 'outline'}
                onClick={() => onKindChange(kind)}
              >
                {PROVIDER_KIND_LABELS[kind]}
              </Button>
            ))}
          </div>
          <Input
            type="text"
            placeholder="Display name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            type="text"
            placeholder={baseURLPlaceholder(form.kind)}
            value={form.baseURL}
            onChange={(e) => setForm((f) => ({ ...f, baseURL: e.target.value }))}
            className="font-mono text-sm"
          />
          <Input
            type="password"
            placeholder="API key"
            autoComplete="off"
            value={form.apiKey}
            onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
            className="font-mono text-sm"
          />
          <Input
            type="text"
            placeholder="Default model (optional)"
            value={form.defaultModel}
            onChange={(e) => setForm((f) => ({ ...f, defaultModel: e.target.value }))}
            className="font-mono text-sm"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? 'Connecting...' : 'Connect provider'}
            </Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={cancelAdd}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={startAdd}>
          Add provider
        </Button>
      )}
    </div>
  )
}
