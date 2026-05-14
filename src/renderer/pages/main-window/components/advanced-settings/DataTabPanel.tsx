import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Database, Share2 } from 'lucide-react'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import type { AppEditionConfig } from '@/shared/edition'
import type { MainWindowAPI } from '@types'
import { DatabaseExportSection } from '../DatabaseExportSection'
import { DatabaseSyncSection } from '../DatabaseSyncSection'
import { SettingsRow } from './SettingsRow'
import { SettingsSection } from './SettingsSection'

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
    <div className="space-y-6">
      <SettingsSection title="Export" icon={<Database className="h-4 w-4" />}>
        <SettingsRow
          label="Manual export"
          description="Download a ZIP of the full database."
          control={<DatabaseExportSection api={api} />}
        />
        <SettingsRow
          layout="stacked"
          label="Folder for periodic export"
          description={
            databaseExportDirectory
              ? 'The raw database is mirrored to this folder on a schedule.'
              : 'Choose a folder to mirror the raw database to on a schedule.'
          }
          control={
            <div className="flex items-center gap-2">
              <Input
                value={databaseExportDirectory}
                readOnly
                placeholder="Not configured"
                aria-label="Raw DB export folder"
                className="flex-1"
              />
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
                    ? 'Change'
                    : 'Choose'}
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
          }
        />
      </SettingsSection>

      {isEnterprise && (
        <SettingsSection
          title="Share with remote"
          icon={<Share2 className="h-4 w-4" />}
          description="Off disables sharing. Summary strips OCR text and full-text search index. Both Summary and Detailed strip personal context; pattern detection runs locally either way."
        >
          <SettingsRow
            layout="stacked"
            label="Detail level"
            control={
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
            }
          />
          {uploadDetailLevel !== 'off' && (
            <SettingsRow
              label="Sync now"
              description="Push the current database to remote."
              control={<DatabaseSyncSection api={api} />}
            />
          )}
        </SettingsSection>
      )}
    </div>
  )
}
