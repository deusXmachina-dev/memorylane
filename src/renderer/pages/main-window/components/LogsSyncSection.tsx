import * as React from 'react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import type { MainWindowAPI } from '@types'

interface LogsSyncSectionProps {
  api: MainWindowAPI
}

export function LogsSyncSection({ api }: LogsSyncSectionProps): React.JSX.Element {
  const [isSyncing, setIsSyncing] = useState(false)

  const handleSync = useCallback(async () => {
    setIsSyncing(true)
    try {
      const result = await api.syncLogsToRemote()
      if (!result.success) {
        toast.error(result.error ?? 'Log sync failed')
        return
      }
      toast.success('Logs synced to remote')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Log sync failed'
      toast.error(message)
    } finally {
      setIsSyncing(false)
    }
  }, [api])

  return (
    <Button size="sm" onClick={() => void handleSync()} disabled={isSyncing}>
      {isSyncing ? 'Syncing...' : 'Sync to Remote'}
    </Button>
  )
}
