import * as React from 'react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'

interface RemoteSyncButtonProps {
  /** Triggers the sync and resolves with its outcome. */
  onSync: () => Promise<{ success: boolean; error?: string }>
  /** Toast shown on success. */
  successMessage: string
  /** Toast shown when the result carries no error, or a non-Error is thrown. */
  fallbackError: string
}

/** "Sync to Remote" button with in-flight state and success/error toasts. */
export function RemoteSyncButton({
  onSync,
  successMessage,
  fallbackError,
}: RemoteSyncButtonProps): React.JSX.Element {
  const [isSyncing, setIsSyncing] = useState(false)

  const handleSync = useCallback(async () => {
    setIsSyncing(true)
    try {
      const result = await onSync()
      if (!result.success) {
        toast.error(result.error ?? fallbackError)
        return
      }
      toast.success(successMessage)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : fallbackError)
    } finally {
      setIsSyncing(false)
    }
  }, [onSync, successMessage, fallbackError])

  return (
    <Button size="sm" onClick={() => void handleSync()} disabled={isSyncing}>
      {isSyncing ? 'Syncing...' : 'Sync to Remote'}
    </Button>
  )
}
