import { app } from 'electron'
import type { MainRuntime } from '@main/runtime'
import { RawDatabaseExportSync } from '@main/services/raw-database-export-sync'
import { BackendUpload } from '@main/services/backend-upload'
import { databaseUploadJob } from '@main/services/database-upload-job'
import { logUploadJob } from '@main/services/log-upload-job'
import { readLogUploadState, writeLogUploadState } from '@main/services/log-upload-store'
import { RemoteBlacklistService } from '@main/services/remote-blacklist-service'
import { readRemoteBlacklist, writeRemoteBlacklist } from '@main/services/remote-blacklist-store'
import { DeviceReportSync } from '@main/services/device-report-sync'
import { readDeviceReportState, writeDeviceReportState } from '@main/services/device-report-store'
import { backendUrlFor } from '@main/system/edition'
import { listenerSet } from '@main/utils/listeners'

export interface ManagedExclusions {
  apps: string[]
  urlPatterns: string[]
}

export interface AppSync {
  databaseExport: RawDatabaseExportSync
  databaseUpload: BackendUpload | null
  logUpload: BackendUpload | null
  getManagedExclusions(): ManagedExclusions
  onManagedExclusionsChanged(listener: () => void): () => void
  kick(reason: string): void
  start(): void
  stop(): Promise<void>
}

export function createSync(runtime: MainRuntime): AppSync {
  const { edition, settings, deviceIdentity, storage } = runtime
  const enterprise = edition === 'enterprise'
  const managedExclusionsChanged = listenerSet()
  const getBackendUrl = (): string => backendUrlFor(edition)
  const getDeviceId = (): string => deviceIdentity.getDeviceId()

  const databaseExport = new RawDatabaseExportSync({
    storage,
    getExportDirectory: () => settings.get().databaseExportDirectory,
    getInstallationId: () => deviceIdentity.getPublicInstallationId(),
  })

  // Both editions report, so the fleet's version distribution is visible server-side.
  const deviceReport = new DeviceReportSync({
    getDeviceId,
    isActivated: enterprise ? runtime.isEnterpriseActivated : () => true,
    getBackendUrl,
    getVersion: () => app.getVersion(),
    getKeySource: () => {
      const { source } = runtime.vendorCredentials.getStatus(settings.get().activeVendor)
      if (source === 'none') return 'none'
      return source === 'managed' ? 'managed' : 'byok'
    },
    edition,
    readStored: () => readDeviceReportState(),
    writeStored: (state) => writeDeviceReportState(state),
  })

  const backend = {
    getDeviceId,
    isActivated: runtime.isEnterpriseActivated,
    isSyncEnabled: () => settings.get().uploadDetailLevel !== 'off',
    getBackendUrl,
    env: runtime.host,
  }
  const databaseUpload = enterprise
    ? new BackendUpload({
        ...backend,
        job: databaseUploadJob({
          storage,
          getStripOptions: () => ({
            detailLevel: settings.get().uploadDetailLevel === 'detailed' ? 'detailed' : 'summary',
          }),
          getLastUploadAt: () => storage.uploadRuns.getLastRunTimestamp(),
          recordUploadAt: (ts) => storage.uploadRuns.record(ts),
        }),
      })
    : null
  const logUpload = enterprise
    ? new BackendUpload({
        ...backend,
        job: logUploadJob({
          readState: () => readLogUploadState(),
          writeState: (state) => writeLogUploadState(state),
        }),
      })
    : null
  const remoteBlacklist = enterprise
    ? new RemoteBlacklistService({
        getDeviceId,
        isActivated: runtime.isEnterpriseActivated,
        getBackendUrl,
        onChange: (blacklist) => {
          runtime.capture.setManagedExclusions(blacklist)
          managedExclusionsChanged.emit()
        },
        readStored: () => readRemoteBlacklist(),
        writeStored: (blacklist) => writeRemoteBlacklist(blacklist),
      })
    : null

  const kick = (reason: string): void => {
    databaseUpload?.kick(reason)
    logUpload?.kick(reason)
  }

  return {
    databaseExport,
    databaseUpload,
    logUpload,
    getManagedExclusions: () => remoteBlacklist?.getBlacklist() ?? { apps: [], urlPatterns: [] },
    onManagedExclusionsChanged: managedExclusionsChanged.add,
    kick,
    start(): void {
      databaseExport.start()
      deviceReport.start()
      databaseUpload?.start()
      logUpload?.start()
      remoteBlacklist?.start()

      let activated = runtime.isEnterpriseActivated()
      runtime.accessProvider.addUpdateListener((state) => {
        if (state.isEnterpriseActivated === activated) return
        activated = state.isEnterpriseActivated
        if (!activated) return
        kick('activated')
        void deviceReport.sync()
      })
      runtime.host.onAwake(() => kick('resume'))
    },
    async stop(): Promise<void> {
      remoteBlacklist?.stop()
      deviceReport.stop()
      await Promise.allSettled([databaseExport.stop(), databaseUpload?.stop(), logUpload?.stop()])
    },
  }
}
