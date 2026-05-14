import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, Plug, RefreshCw } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { SettingsSection } from '../components/advanced-settings/SettingsSection'
import { SettingsRow } from '../components/advanced-settings/SettingsRow'
import type { MainWindowAPI, McpEntryStatus, McpRegistrationStatus } from '@types'

interface IntegrationsSectionProps {
  api: MainWindowAPI
}

const PROVIDERS: {
  name: string
  label: string
  register: (api: MainWindowAPI) => Promise<boolean>
}[] = [
  { name: 'claudeDesktop', label: 'Claude Cowork', register: (api) => api.addToClaude() },
  { name: 'claudeCode', label: 'Claude Code', register: (api) => api.addToClaudeCode() },
]

function describe(entryStatus: McpEntryStatus, label: string): string | undefined {
  switch (entryStatus) {
    case 'stale':
      return 'App path changed — reconnect to restore access.'
    case 'not-registered':
      return `Add MemoryLane to ${label}'s MCP config.`
    case 'current':
      return undefined
  }
}

export function IntegrationsSection({ api }: IntegrationsSectionProps): React.JSX.Element {
  const [status, setStatus] = useState<McpRegistrationStatus | null>(null)
  const [adding, setAdding] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api.getMcpStatus())
    } catch {
      // leave as-is
    }
  }, [api])

  useEffect(() => {
    void loadStatus()
    const handleFocus = (): void => {
      void loadStatus()
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [loadStatus])

  const handleAdd = useCallback(
    async (provider: (typeof PROVIDERS)[number], isReconnect: boolean) => {
      setAdding(provider.name)
      try {
        const ok = await provider.register(api)
        await loadStatus()
        if (ok) {
          toast.success(
            isReconnect ? `Reconnected to ${provider.label}` : `Connected to ${provider.label}`,
            { description: `Quit and relaunch ${provider.label} to activate.` },
          )
        } else {
          toast.error(`Failed to connect to ${provider.label}`)
        }
      } catch {
        toast.error(`Failed to connect to ${provider.label}`)
      } finally {
        setAdding(null)
      }
    },
    [api, loadStatus],
  )

  return (
    <SettingsSection
      title="Integrations"
      icon={<Plug className="h-4 w-4" />}
      description="Register MemoryLane as an MCP server. Quit and relaunch the assistant after connecting so it picks up MemoryLane."
    >
      {PROVIDERS.map((provider) => {
        const entryStatus = status?.[provider.name] ?? 'not-registered'
        const isStale = entryStatus === 'stale'
        const isCurrent = entryStatus === 'current'
        const isBusy = adding === provider.name

        let control: React.ReactNode
        if (isCurrent) {
          control = (
            <Badge variant="secondary">
              <Check /> Connected
            </Badge>
          )
        } else if (isStale) {
          control = (
            <Button
              variant="secondary"
              size="sm"
              disabled={adding !== null}
              onClick={() => void handleAdd(provider, true)}
            >
              {isBusy ? (
                'Reconnecting...'
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5" /> Reconnect
                </>
              )}
            </Button>
          )
        } else {
          control = (
            <Button
              size="sm"
              disabled={adding !== null}
              onClick={() => void handleAdd(provider, false)}
            >
              {isBusy ? (
                'Connecting...'
              ) : (
                <>
                  <Plug className="h-3.5 w-3.5" /> Connect
                </>
              )}
            </Button>
          )
        }

        return (
          <SettingsRow
            key={provider.name}
            label={provider.label}
            description={describe(entryStatus, provider.label)}
            control={control}
          />
        )
      })}
    </SettingsSection>
  )
}
