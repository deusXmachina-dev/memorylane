import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { Card, CardContent } from '@components/ui/card'
import type { MainWindowAPI } from '@types'

interface ConnectClaudeSectionProps {
  api: MainWindowAPI
}

const STORAGE_KEY = 'claude-connected'

export function ConnectClaudeSection({ api }: ConnectClaudeSectionProps): React.JSX.Element | null {
  const [connected, setConnected] = useState(() => localStorage.getItem(STORAGE_KEY) === 'true')
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(connected))
  }, [connected])

  const handleConnect = useCallback(async () => {
    setConnecting(true)
    try {
      await api.addToClaude()
      setConnected(true)
      toast.success('Connected to Claude Desktop')
    } catch {
      toast.error('Failed to connect to Claude Desktop')
    } finally {
      setConnecting(false)
    }
  }, [api])

  if (connected) return null

  return (
    <Card>
      <CardContent className="flex items-center justify-between">
        <span className="text-sm">Connect to Claude Desktop</span>
        <Button size="sm" disabled={connecting} onClick={() => void handleConnect()}>
          {connecting ? 'Connecting...' : 'Connect'}
        </Button>
      </CardContent>
    </Card>
  )
}
