import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, Plug, RefreshCw } from 'lucide-react'
import { Button } from '@components/ui/button'
import { Label } from '@components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import type { MainWindowAPI, McpRegistrationStatus } from '@types'

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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Integrations</CardTitle>
        <CardDescription className="text-xs">
          Register MemoryLane as an MCP server for AI assistants.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex gap-2">
        {PROVIDERS.map((provider) => {
          const entryStatus = status?.[provider.name] ?? 'not-registered'
          const isStale = entryStatus === 'stale'
          const isCurrent = entryStatus === 'current'
          const isBusy = adding === provider.name
          return (
            <div key={provider.name} className="flex-1 flex flex-col items-center gap-1">
              <Label className="text-xs text-muted-foreground">{provider.label}</Label>
              <Button
                variant={isStale ? 'secondary' : 'outline'}
                size="sm"
                className="w-full"
                disabled={isCurrent || adding !== null}
                onClick={() => void handleAdd(provider, isStale)}
              >
                {isBusy ? (
                  isStale ? (
                    'Reconnecting...'
                  ) : (
                    'Connecting...'
                  )
                ) : isCurrent ? (
                  <>
                    <Check className="h-3.5 w-3.5" /> Connected
                  </>
                ) : isStale ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5" /> Reconnect
                  </>
                ) : (
                  <>
                    <Plug className="h-3.5 w-3.5" /> Connect
                  </>
                )}
              </Button>
              {isStale && (
                <p className="text-[10px] text-muted-foreground text-center leading-tight">
                  App path changed — reconnect to restore access.
                </p>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
