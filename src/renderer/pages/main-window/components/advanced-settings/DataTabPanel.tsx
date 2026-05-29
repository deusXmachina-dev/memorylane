import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Database, Share2 } from 'lucide-react'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import type { AppEditionConfig } from '@/shared/edition'
import { PURGE_CONFIRMATION_PHRASE } from '@/shared/constants'
import type { MainWindowAPI } from '@types'
import { DatabaseExportSection } from '../DatabaseExportSection'
import { DatabaseImportSection } from '../DatabaseImportSection'
import { DatabaseSyncSection } from '../DatabaseSyncSection'
import { SegmentedControl } from './SegmentedControl'
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
  const [isPurgeExpanded, setIsPurgeExpanded] = useState(false)
  const [purgeConfirmation, setPurgeConfirmation] = useState('')
  const [isPurging, setIsPurging] = useState(false)

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

  const resetPurgeState = useCallback(() => {
    setIsPurgeExpanded(false)
    setPurgeConfirmation('')
  }, [])

  const handlePurge = useCallback(async () => {
    if (purgeConfirmation !== PURGE_CONFIRMATION_PHRASE) return
    setIsPurging(true)
    try {
      const result = await api.purgeDatabase(purgeConfirmation)
      if (result.success) {
        toast.success('Database purged.')
        resetPurgeState()
      } else {
        toast.error(result.error ?? 'Failed to purge database')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to purge database'
      toast.error(message)
    } finally {
      setIsPurging(false)
    }
  }, [api, purgeConfirmation, resetPurgeState])

  const isEnterprise = editionConfig?.edition === 'enterprise'
  const canConfirmPurge = purgeConfirmation === PURGE_CONFIRMATION_PHRASE && !isPurging

  return (
    <div className="space-y-6">
      <SettingsSection title="Export" icon={<Database className="h-4 w-4" />}>
        <SettingsRow
          label="Manual export"
          description="Download a ZIP of the full database."
          control={<DatabaseExportSection api={api} />}
        />
        <SettingsRow
          label="Manual import"
          description="Replace the database from an exported ZIP or .db file."
          control={<DatabaseImportSection api={api} />}
        />
        {!isEnterprise && (
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
        )}
      </SettingsSection>

      {isEnterprise && (
        <SettingsSection
          title="Share with remote"
          icon={<Share2 className="h-4 w-4" />}
          description="Off disables sharing. Summary strips OCR text and full-text search index."
        >
          <SettingsRow
            layout="stacked"
            label="Detail level"
            control={
              <SegmentedControl
                ariaLabel="Detail level"
                value={uploadDetailLevel}
                onChange={onUploadDetailLevelChange}
                options={[
                  { value: 'off', label: 'Off' },
                  { value: 'summary', label: 'Summary' },
                  { value: 'detailed', label: 'Detailed' },
                ]}
              />
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

      <SettingsSection title="Danger zone" icon={<AlertTriangle className="h-4 w-4" />}>
        {!isPurgeExpanded ? (
          <SettingsRow
            label="Purge database"
            description="Permanently delete all activities, patterns and other captured data. Capture resumes afterwards if it was running. This cannot be undone."
            control={
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setIsPurgeExpanded(true)}
              >
                Purge database
              </Button>
            }
          />
        ) : (
          <SettingsRow
            layout="stacked"
            label="Purge database"
            description="This will erase the entire MemoryLane database. This action cannot be undone."
            control={
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="purge-confirmation" className="text-xs text-foreground">
                    Type <code className="font-mono">{PURGE_CONFIRMATION_PHRASE}</code> to confirm
                  </Label>
                  <Input
                    id="purge-confirmation"
                    value={purgeConfirmation}
                    onChange={(event) => setPurgeConfirmation(event.target.value)}
                    placeholder={PURGE_CONFIRMATION_PHRASE}
                    autoComplete="off"
                    autoFocus
                    disabled={isPurging}
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={resetPurgeState}
                    disabled={isPurging}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={!canConfirmPurge}
                    onClick={() => void handlePurge()}
                  >
                    {isPurging ? 'Purging…' : 'I understand, purge everything'}
                  </Button>
                </div>
              </div>
            }
          />
        )}
      </SettingsSection>
    </div>
  )
}
