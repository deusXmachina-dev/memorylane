import * as React from 'react'
import { RemoteSyncButton } from './RemoteSyncButton'
import type { MainWindowAPI } from '@types'

interface DatabaseSyncSectionProps {
  api: MainWindowAPI
}

export function DatabaseSyncSection({ api }: DatabaseSyncSectionProps): React.JSX.Element {
  return (
    <RemoteSyncButton
      onSync={() => api.syncDatabaseToRemote()}
      successMessage="Database synced to remote"
      fallbackError="Sync failed"
    />
  )
}
