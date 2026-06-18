import * as React from 'react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import type { MainWindowAPI } from '@types'

interface LogsExportSectionProps {
  api: MainWindowAPI
}

export function LogsExportSection({ api }: LogsExportSectionProps): React.JSX.Element {
  const [isExportingLogs, setIsExportingLogs] = useState(false)

  const handleExportLogs = useCallback(async () => {
    setIsExportingLogs(true)
    try {
      const result = await api.exportLogsZip()
      if (result.cancelled) return
      if (!result.success) {
        toast.error(result.error ?? 'Logs export failed')
        return
      }
      toast.success(`Logs exported: ${result.outputPath ?? 'ZIP created'}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Logs export failed'
      toast.error(message)
    } finally {
      setIsExportingLogs(false)
    }
  }, [api])

  return (
    <Button size="sm" onClick={() => void handleExportLogs()} disabled={isExportingLogs}>
      {isExportingLogs ? 'Exporting...' : 'Export Logs (.zip)'}
    </Button>
  )
}
