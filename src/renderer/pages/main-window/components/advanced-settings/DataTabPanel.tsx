import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Database, Share2 } from 'lucide-react'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import type { AppEditionConfig } from '@/shared/edition'
import type { MainWindowAPI } from '@types'
import { DatabaseExportSection } from '../DatabaseExportSection'
import { DatabaseSyncSection } from '../DatabaseSyncSection'
import { SettingsRow } from './SettingsRow'
import { SettingsSection } from './SettingsSection'

const PURGE_CONFIRMATION_PHRASE = 'delete-memorylane'

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

      <section className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Danger zone
        </div>
        <div className="rounded-md border border-destructive/40 p-3">
          {!isPurgeExpanded ? (
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5 min-w-0">
                <p className="text-sm font-medium text-foreground">Purge database</p>
                <p className="text-xs text-muted-foreground">
                  Permanently delete all activities, patterns, embeddings, and screenshots. This
                  cannot be undone.
                </p>
              </div>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setIsPurgeExpanded(true)}
              >
                Purge database…
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-foreground">Purge database</p>
                <p className="text-xs text-muted-foreground">
                  This will erase the entire MemoryLane database and all captured screenshots on
                  this Mac. This action cannot be undone.
                </p>
              </div>
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
          )}
        </div>
      </section>
    </div>
  )
}
