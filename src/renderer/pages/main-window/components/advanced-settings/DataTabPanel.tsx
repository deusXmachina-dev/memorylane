import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import type { AppEditionConfig } from '@/shared/edition'
import type { MainWindowAPI } from '@types'
import { DatabaseExportSection } from '../DatabaseExportSection'
import { DatabaseSyncSection } from '../DatabaseSyncSection'

interface DataTabPanelProps {
  api: MainWindowAPI
  editionConfig: AppEditionConfig | null
  databaseExportDirectory: string
  onDatabaseExportDirectoryChange: (directoryPath: string) => void
  uploadDetailLevel: 'off' | 'summary' | 'detailed'
  onUploadDetailLevelChange: (level: 'off' | 'summary' | 'detailed') => void
}

export function DataTabPanel({
  api,
  editionConfig,
  databaseExportDirectory,
  onDatabaseExportDirectoryChange,
  uploadDetailLevel,
  onUploadDetailLevelChange,
}: DataTabPanelProps): React.JSX.Element {
  const [isChoosingDirectory, setIsChoosingDirectory] = useState(false)

  const handleChooseDirectory = useCallback(async () => {
    setIsChoosingDirectory(true)
    try {
      const result = await api.chooseDatabaseExportDirectory(databaseExportDirectory)
      if (result.cancelled) {
        return
      }
      if (result.error) {
        toast.error(result.error)
        return
      }
      if (result.directoryPath) {
        onDatabaseExportDirectoryChange(result.directoryPath)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to choose folder'
      toast.error(message)
    } finally {
      setIsChoosingDirectory(false)
    }
  }, [api, databaseExportDirectory, onDatabaseExportDirectoryChange])

  const isEnterprise = editionConfig?.edition === 'enterprise'

  return (
    <section className="space-y-5">
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Manual Export</Label>
        <div className="flex gap-2">
          <DatabaseExportSection api={api} />
        </div>
      </div>

      {isEnterprise && (
        <>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Share with remote</p>
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant={uploadDetailLevel === 'off' ? 'default' : 'outline'}
                size="sm"
                onClick={() => onUploadDetailLevelChange('off')}
              >
                Off
              </Button>
              <Button
                variant={uploadDetailLevel === 'summary' ? 'default' : 'outline'}
                size="sm"
                onClick={() => onUploadDetailLevelChange('summary')}
              >
                Summary
              </Button>
              <Button
                variant={uploadDetailLevel === 'detailed' ? 'default' : 'outline'}
                size="sm"
                onClick={() => onUploadDetailLevelChange('detailed')}
              >
                Detailed
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Off disables sharing. Summary strips OCR text and full-text search index. Both Summary
              and Detailed strip personal context; pattern detection runs locally either way.
            </p>
          </div>

          {uploadDetailLevel !== 'off' && (
            <div className="space-y-2">
              <DatabaseSyncSection api={api} />
            </div>
          )}
        </>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label className="text-xs text-muted-foreground">Folder for periodic export</Label>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleChooseDirectory()}
              disabled={isChoosingDirectory}
            >
              {isChoosingDirectory
                ? 'Choosing...'
                : databaseExportDirectory
                  ? 'Change Folder'
                  : 'Choose Folder'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!databaseExportDirectory}
              onClick={() => onDatabaseExportDirectoryChange('')}
            >
              Clear
            </Button>
          </div>
        </div>

        <Input
          value={databaseExportDirectory}
          readOnly
          placeholder="Not configured"
          aria-label="Raw DB export folder"
        />
      </div>
    </section>
  )
}
