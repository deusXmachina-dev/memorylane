import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { SiClaude } from '@icons-pack/react-simple-icons'
import { Button } from '@components/ui/button'
import { OnboardingCard } from './OnboardingCard'
import { OnboardingStep } from './OnboardingStep'
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
    <OnboardingStep>
      <OnboardingStep.Header
        title="Pick your AI assistant"
        subtitle="Connect MemoryLane so your assistant can see patterns and help you act on them."
      />

      <div className="space-y-2">
        {PROVIDERS.map((provider) => {
          const connected = Boolean(mcpStatus?.[provider.name])
          const isAdding = adding === provider.name
          const Icon = provider.icon
          const action = isAdding ? (
            <span className="text-xs text-muted-foreground">Connecting...</span>
          ) : connected ? (
            <span className="text-xs font-medium text-primary">Connected</span>
          ) : null
          return (
            <OnboardingCard
              key={provider.name}
              tone={connected ? 'success' : 'default'}
              icon={<Icon className="size-4" />}
              title={provider.label}
              description={provider.description}
              action={action}
              onClick={connected ? undefined : () => void handleAdd(provider)}
              disabled={!connected && adding !== null}
            />
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        You may need to restart Claude Code / Cowork after connecting for the MCP to appear.
      </p>

      <div className="pt-2">
        <Button size="lg" onClick={onContinue}>
          Continue
        </Button>
      </div>
    </OnboardingStep>
  )
}
