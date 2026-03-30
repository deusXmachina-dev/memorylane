import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { SiClaude } from '@icons-pack/react-simple-icons'
import { Card, CardHeader, CardTitle, CardDescription, CardAction } from '@components/ui/card'
import { Button } from '@components/ui/button'
import type { MainWindowAPI, McpRegistrationStatus } from '@types'

const PROVIDERS: {
  name: string
  label: string
  description: string
  icon: React.ElementType
  register: (api: MainWindowAPI) => Promise<boolean>
}[] = [
  {
    name: 'claudeDesktop',
    label: 'Claude Cowork',
    description: 'Anthropic desktop app',
    icon: SiClaude,
    register: (api) => api.addToClaude(),
  },
  {
    name: 'claudeCode',
    label: 'Claude Code',
    description: 'CLI and IDE extensions',
    icon: SiClaude,
    register: (api) => api.addToClaudeCode(),
  },
]

interface ConnectStepProps {
  api: MainWindowAPI
  mcpStatus: McpRegistrationStatus | null
  onStatusChange: () => void
  onContinue: () => void
}

export function ConnectStep({
  api,
  mcpStatus,
  onStatusChange,
  onContinue,
}: ConnectStepProps): React.JSX.Element {
  const [adding, setAdding] = useState<string | null>(null)
  const anyConnected = mcpStatus !== null && Object.values(mcpStatus).some(Boolean)

  const handleAdd = useCallback(
    async (provider: (typeof PROVIDERS)[number]) => {
      setAdding(provider.name)
      try {
        const ok = await provider.register(api)
        onStatusChange()
        if (ok) {
          toast.success(`Connected to ${provider.label}`)
        } else {
          toast.error(`Failed to connect to ${provider.label}`)
        }
      } catch {
        toast.error(`Failed to connect to ${provider.label}`)
      } finally {
        setAdding(null)
      }
    },
    [api, onStatusChange],
  )

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Pick your AI assistant</h2>
        <p className="text-xs text-muted-foreground">
          Connect MemoryLane so your assistant can see patterns and help you act on them.
        </p>
      </div>

      <div className="space-y-2">
        {PROVIDERS.map((provider) => {
          const connected = mcpStatus?.[provider.name]
          const Icon = provider.icon
          return (
            <Card
              key={provider.name}
              size="sm"
              className={`cursor-pointer transition-colors ${
                connected
                  ? 'ring-foreground/20 bg-primary/5'
                  : adding !== null
                    ? 'opacity-60'
                    : 'hover:ring-foreground/20 hover:bg-accent'
              }`}
              onClick={() => {
                if (!connected && adding === null) void handleAdd(provider)
              }}
            >
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary">
                    <Icon className="h-4 w-4 text-foreground" />
                  </div>
                  <div>
                    <CardTitle className="text-sm">{provider.label}</CardTitle>
                    <CardDescription className="text-xs">{provider.description}</CardDescription>
                  </div>
                </div>
                <CardAction className="self-center">
                  {adding === provider.name ? (
                    <span className="text-xs text-muted-foreground">Connecting...</span>
                  ) : connected ? (
                    <span className="text-xs text-muted-foreground">Connected</span>
                  ) : null}
                </CardAction>
              </CardHeader>
            </Card>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        You may need to restart Claude Code / Cowork after connecting for the MCP to appear.
      </p>

      <Button size="lg" className="w-full" disabled={!anyConnected} onClick={onContinue}>
        Continue
      </Button>
    </div>
  )
}
