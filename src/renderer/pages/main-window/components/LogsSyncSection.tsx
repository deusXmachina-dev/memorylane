import * as React from 'react'
import { RemoteSyncButton } from './RemoteSyncButton'
import type { MainWindowAPI } from '@types'

interface LogsSyncSectionProps {
  api: MainWindowAPI
}

export function LogsSyncSection({ api }: LogsSyncSectionProps): React.JSX.Element {
  return (
    <RemoteSyncButton
      onSync={() => api.syncLogsToRemote()}
      successMessage="Logs synced to remote"
      fallbackError="Log sync failed"
    />
  )
}
