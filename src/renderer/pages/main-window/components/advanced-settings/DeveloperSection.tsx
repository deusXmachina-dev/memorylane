import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { TrashIcon } from '@phosphor-icons/react'
import { Button } from '@components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@components/ui/tabs'
import type { MainWindowAPI } from '@types'
import { setDevMode } from '@/renderer/lib/dev-mode'
import { SettingsSection } from './SettingsSection'
import { TaskGoldenSection } from './TaskGoldenSection'
import { RecorderSection } from './eval-recorder/RecorderSection'

export function DeveloperSection({ api }: { api: MainWindowAPI }): React.JSX.Element {
  return (
    <div className="space-y-6">
      <Tabs defaultValue="recorder">
        <TabsList>
          <TabsTrigger value="recorder">Recorder</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
        </TabsList>
        <TabsContent value="recorder" className="pt-2">
          <RecorderSection api={api} />
        </TabsContent>
        <TabsContent value="tasks" className="pt-2">
          <div className="space-y-6">
            <TaskMaintenanceSection api={api} />
            <TaskGoldenSection api={api} />
          </div>
        </TabsContent>
      </Tabs>

      <div className="pt-2">
        <Button variant="outline" size="sm" onClick={() => setDevMode(false)}>
          Disable Developer mode
        </Button>
      </div>
    </div>
  )
}

/**
 * Wipe all mined sightings + clusters and re-mine the recent window from
 * scratch. Activities (the source data) are untouched — this only rebuilds
 * derived task data, e.g. after a prompt change.
 */
function TaskMaintenanceSection({ api }: { api: MainWindowAPI }): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const wipeAndRemine = useCallback(async () => {
    setConfirming(false)
    setBusy(true)
    toast.loading('Wiping tasks and re-mining…', { id: 'wipe-remine' })
    const result = await api.wipeAndRemineTasks()
    setBusy(false)
    if (!result.success) {
      toast.error(result.error ?? 'Wipe & re-mine failed', { id: 'wipe-remine' })
      return
    }
    const s = result.summary
    if (s?.skipped) {
      toast.error(
        s.skipped === 'no-provider'
          ? 'Tasks wiped, but re-mine skipped: no inference provider configured'
          : 'Skipped: a mining run is already in progress. Nothing was wiped — try again shortly.',
        { id: 'wipe-remine' },
      )
      return
    }
    if (s?.abortReason === 'offline') {
      toast.warning(
        `Re-mined ${s.daysMined} day(s), then stopped: no network. Mining resumes shortly.`,
        { id: 'wipe-remine' },
      )
      return
    }
    if (s?.abortReason === 'rate-limit') {
      toast.warning(
        `Re-mined ${s.daysMined} day(s), then stopped: provider rate limited. Mining resumes shortly.`,
        { id: 'wipe-remine' },
      )
      return
    }
    toast.success(
      `Re-mined ${s?.daysMined ?? 0} day(s)` + (s?.daysFailed ? ` (${s.daysFailed} failed)` : ''),
      { id: 'wipe-remine' },
    )
  }, [api])

  const retryFailedDays = useCallback(async () => {
    const { retried } = await api.retryFailedMiningDays()
    if (retried === 0) {
      toast.info('No mining days to retry')
      return
    }
    toast.success(`Reopened ${retried} day(s) — mining resumes shortly`)
  }, [api])

  return (
    <SettingsSection
      title="Wipe & re-mine tasks"
      description="Deletes every mined sighting and cluster, then re-mines the recent window from scratch with the current prompt. Activities (the source data) are untouched."
    >
      <div className="flex items-center gap-2 py-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void retryFailedDays()}
          disabled={busy}
        >
          Retry failed days
        </Button>
        {confirming ? (
          <>
            <span className="text-sm text-muted-foreground">
              Delete all sightings + clusters and re-mine?
            </span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void wipeAndRemine()}
              disabled={busy}
            >
              Confirm
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirming(true)}
            disabled={busy}
          >
            <TrashIcon /> Wipe all tasks &amp; re-mine
          </Button>
        )}
      </div>
    </SettingsSection>
  )
}
