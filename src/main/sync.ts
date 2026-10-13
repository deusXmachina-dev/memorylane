import { app } from 'electron'
import type { MainRuntime } from '@main/runtime'
import { RawDatabaseExportSync } from '@main/services/raw-database-export-sync'
import { BackendUpload } from '@main/services/backend-upload'
import { databaseUploadJob } from '@main/services/database-upload-job'
import { logUploadJob } from '@main/services/log-upload-job'
import { readLogUploadState, writeLogUploadState } from '@main/services/log-upload-store'
import { RemoteBlacklistService } from '@main/services/remote-blacklist-service'
import { RemoteModelConfigService } from '@main/services/remote-model-config-service'
import {
  readRemoteModelConfig,
  writeRemoteModelConfig,
} from '@main/services/remote-model-config-store'
import { readRemoteBlacklist, writeRemoteBlacklist } from '@main/services/remote-blacklist-store'
import { deviceReportJob } from '@main/services/device-report-job'
import { readDeviceReportState, writeDeviceReportState } from '@main/services/device-report-store'
import { listenerSet } from '@main/utils/listeners'

export interface ManagedExclusions {
  apps: string[]
  urlPatterns: string[]
}

export interface AppSync {
  databaseExport: RawDatabaseExportSync
  remoteModels: RemoteModelConfigService
  databaseUpload: BackendUpload | null
  logUpload: BackendUpload | null
  getManagedExclusions(): ManagedExclusions
  onManagedExclusionsChanged(listener: () => void): () => void
  kick(reason: string): void
  start(): void
  stop(): Promise<void>
}

export function createSync(runtime: MainRuntime): AppSync {
  const { edition, settings, deviceIdentity, storage, backend } = runtime
  const enterprise = edition === 'enterprise'
  const managedExclusionsChanged = listenerSet()

  const databaseExport = new RawDatabaseExportSync({
    storage,
    getExportDirectory: () => settings.get().databaseExportDirectory,
    getInstallationId: () => deviceIdentity.getPublicInstallationId(),
  })

  const remoteModels = new RemoteModelConfigService({
    backend,
    isActivated: () => runtime.isManaged() && (!enterprise || runtime.isEnterpriseActivated()),
    onChange: (config) => runtime.setRemoteModelConfig(config),
    readStored: () => readRemoteModelConfig(),
    writeStored: (config) => writeRemoteModelConfig(config),
  })

  // Both editions report, so the fleet's version distribution is visible server-side.
  const deviceReport = new BackendUpload({
    backend,
    isActivated: enterprise ? runtime.isEnterpriseActivated : () => true,
    job: deviceReportJob({
      getVersion: () => app.getVersion(),
      getKeySource: () => {
        const { source } = runtime.vendorCredentials.getStatus(settings.get().activeVendor)
        if (source === 'none') return 'none'
        return source === 'managed' ? 'managed' : 'byok'
      },
      edition,
      readStored: () => readDeviceReportState(),
      writeStored: (state) => writeDeviceReportState(state),
    }),
  })

  const uploads = {
    backend,
    isActivated: runtime.isEnterpriseActivated,
    isSyncEnabled: () => settings.get().uploadDetailLevel !== 'off',
  }
  const databaseUpload = enterprise
    ? new BackendUpload({
        ...uploads,
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
        ...uploads,
        job: logUploadJob({
          readState: () => readLogUploadState(),
          writeState: (state) => writeLogUploadState(state),
        }),
      })
    : null
  const remoteBlacklist = enterprise
    ? new RemoteBlacklistService({
        backend,
        isActivated: runtime.isEnterpriseActivated,
        onChange: (blacklist) => {
          runtime.harness.setManagedExclusions(blacklist)
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
    remoteModels,
    databaseUpload,
    logUpload,
    getManagedExclusions: () => remoteBlacklist?.getBlacklist() ?? { apps: [], urlPatterns: [] },
    onManagedExclusionsChanged: managedExclusionsChanged.add,
    kick,
    start(): void {
      databaseExport.start()
      remoteModels.start()
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
        deviceReport.kick('activated')
      })
      runtime.host.onAwake(() => kick('resume'))
    },
    async stop(): Promise<void> {
      await Promise.allSettled([
        databaseExport.stop(),
        remoteModels.stop(),
        deviceReport.stop(),
        databaseUpload?.stop(),
        logUpload?.stop(),
        remoteBlacklist?.stop(),
      ])
    },
  }
}
