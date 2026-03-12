import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import type { MainWindowAPI } from '@types'
import { IntegrationsSection } from '../IntegrationsSection'
import { DatabaseExportSection } from '../DatabaseExportSection'
import { SectionToggle } from './SectionToggle'
import { SubSectionToggle } from './SubSectionToggle'

interface ConnectionsDataSectionProps {
  api: MainWindowAPI
  open: boolean
  onToggle: () => void
  databaseExportDirectory: string
  onDatabaseExportDirectoryChange: (directoryPath: string) => void
}

export function ConnectionsDataSection({
  api,
  open,
  onToggle,
  databaseExportDirectory,
  onDatabaseExportDirectoryChange,
}: ConnectionsDataSectionProps): React.JSX.Element {
  const [isChoosingDirectory, setIsChoosingDirectory] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

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

  return (
    <section>
      <SectionToggle label="Connections & Data" open={open} onToggle={onToggle} />
      {open && (
        <div className="mt-3 space-y-5">
          <IntegrationsSection api={api} />

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Manual Export</Label>
            <DatabaseExportSection api={api} />
          </div>

          <div className="pl-2">
            <SubSectionToggle
              label="More"
              open={moreOpen}
              onToggle={() => setMoreOpen((v) => !v)}
            />
            {moreOpen && (
              <div className="mt-3 space-y-5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label className="text-xs text-muted-foreground">
                      Folder for periodic export
                    </Label>
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
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
