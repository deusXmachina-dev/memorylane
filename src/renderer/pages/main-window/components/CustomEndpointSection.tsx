import * as React from 'react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Badge } from '@components/ui/badge'
import type { CustomEndpointStatus, MainWindowAPI } from '@types'

interface CustomEndpointSectionProps {
  api: MainWindowAPI
  endpointStatus: CustomEndpointStatus
  onEndpointChanged: () => void
}

function validateURL(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

export function CustomEndpointSection({
  api,
  endpointStatus,
  onEndpointChanged,
}: CustomEndpointSectionProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [serverURL, setServerURL] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const showForm = open && (editing || !endpointStatus.enabled)

  const handleSave = useCallback(async () => {
    const url = serverURL.trim()
    const modelName = model.trim()

    if (!url) {
      toast.error('Please enter a server URL')
      return
    }
    if (!validateURL(url)) {
      toast.error('Invalid URL format')
      return
    }
    if (!modelName) {
      toast.error('Please enter a model name')
      return
    }

    setSaving(true)
    try {
      const config = { serverURL: url, model: modelName, apiKey: apiKey.trim() || undefined }
      const result = await api.saveCustomEndpoint(config)
      if (result.success) {
        setServerURL('')
        setModel('')
        setApiKey('')
        setEditing(false)
        toast.success('Custom endpoint saved')
        onEndpointChanged()
      } else {
        toast.error(result.error ?? 'Failed to save endpoint')
      }
    } finally {
      setSaving(false)
    }
  }, [api, serverURL, model, apiKey, onEndpointChanged])

  const handleDelete = useCallback(async () => {
    setDeleting(true)
    try {
      const result = await api.deleteCustomEndpoint()
      if (result.success) {
        setEditing(false)
        toast.success('Custom endpoint removed')
        onEndpointChanged()
      } else {
        toast.error(result.error ?? 'Failed to remove endpoint')
      }
    } finally {
      setDeleting(false)
    }
  }, [api, onEndpointChanged])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        void handleSave()
      }
    },
    [handleSave],
  )

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-[10px]">{open ? '\u25BC' : '\u25B6'}</span>
        Custom endpoint
        {endpointStatus.enabled && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            Active
          </Badge>
        )}
      </button>

      {open && endpointStatus.enabled && !editing && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="font-mono text-xs">
              {endpointStatus.serverURL}
            </Badge>
            <Badge variant="outline" className="font-mono text-xs">
              {endpointStatus.model}
            </Badge>
            {endpointStatus.hasApiKey && (
              <Badge variant="outline" className="text-xs">
                Key set
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Change
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? 'Removing...' : 'Remove'}
            </Button>
          </div>
        </div>
      )}

      {showForm && (
        <div className="space-y-2">
          <Input
            type="text"
            placeholder="http://localhost:11434/v1"
            value={serverURL}
            onChange={(e) => setServerURL(e.target.value)}
            onKeyDown={handleKeyDown}
            className="font-mono text-sm"
          />
          <Input
            type="text"
            placeholder="llama3.2-vision"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onKeyDown={handleKeyDown}
            className="font-mono text-sm"
          />
          <Input
            type="password"
            placeholder="API key (optional)"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={handleKeyDown}
            className="font-mono text-sm"
          />
          <div className="flex gap-2">
            <Button
              className="flex-1"
              size="sm"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? 'Saving...' : 'Save Endpoint'}
            </Button>
            {endpointStatus.enabled && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Connect to any OpenAI-compatible API (Ollama, vLLM, LocalAI, etc.)
          </p>
        </div>
      )}
    </div>
  )
}
