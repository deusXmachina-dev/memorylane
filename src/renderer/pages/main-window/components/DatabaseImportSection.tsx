import * as React from 'react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import type { MainWindowAPI } from '@types'

interface DatabaseImportSectionProps {
  api: MainWindowAPI
}

export function DatabaseImportSection({ api }: DatabaseImportSectionProps): React.JSX.Element {
  const [isImportingDb, setIsImportingDb] = useState(false)

  const handleImportDatabase = useCallback(async () => {
    setIsImportingDb(true)
    try {
      const result = await api.importDatabase()
      if (result.cancelled) return
      if (!result.success) {
        toast.error(result.error ?? 'Database import failed')
        return
      }
      // The imported DB is staged; it replaces the live one on restart.
      toast.success('Database imported — restarting…')
      await new Promise((resolve) => setTimeout(resolve, 800))
      await api.restartApp()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Database import failed'
      toast.error(message)
    } finally {
      setIsImportingDb(false)
    }
  }, [api])

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void handleImportDatabase()}
      disabled={isImportingDb}
    >
      {isImportingDb ? 'Importing...' : 'Import Database'}
    </Button>
  )
}
