import { app } from 'electron'
import { createAccessProvider, type AccessProvider } from '@main/access'
import { requiresActivation } from '@main/access/types'
import type { AppEdition } from '@/shared/edition'
import type { RemoteModelConfig } from '@/shared/remote-model-config'
import type { AppSettingsManager } from '@main/settings/app-settings-manager'
import type { DeviceIdentity } from '@main/settings/device-identity'
import type { VendorCredentialsManager } from '@main/settings/vendor-credentials-manager'
import type { StorageService } from '@main/storage'
import type { HostEnvironment } from '@main/monitoring/host-environment'
import { BackendClient } from '@main/services/backend-client'
import { backendUrlFor } from '@main/system/edition'
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

export interface SyncDeps {
  edition: AppEdition
  settings: AppSettingsManager
  deviceIdentity: DeviceIdentity
  vendorCredentials: VendorCredentialsManager
  storage: StorageService
  host: HostEnvironment
  isManaged(): boolean
  onRemoteModelConfig(config: RemoteModelConfig): void
  onManagedExclusions(exclusions: ManagedExclusions): void
}

export interface AppSync {
  access: AccessProvider
  isEnterpriseActivated(): boolean
  requiresActivation(): boolean
  remoteModels: RemoteModelConfigService
  databaseUpload: BackendUpload | null
  logUpload: BackendUpload | null
  getManagedExclusions(): ManagedExclusions
  onManagedExclusionsChanged(listener: () => void): () => void
  kick(reason: string): void
  start(): void
  stop(): Array<[name: string, step: Promise<void>]>
}

export function createSync(deps: SyncDeps): AppSync {
  const { edition, settings, deviceIdentity, vendorCredentials, storage, host } = deps
  const enterprise = edition === 'enterprise'
  const access = createAccessProvider(edition, deviceIdentity)
  const isEnterpriseActivated = (): boolean => access.getAccessState().isEnterpriseActivated
  const backend = new BackendClient({
    getDeviceId: () => deviceIdentity.getDeviceId(),
    getBackendUrl: () => backendUrlFor(edition),
    env: host,
  })
  const managedExclusionsChanged = listenerSet()

  const remoteModels = new RemoteModelConfigService({
    backend,
    isActivated: () => deps.isManaged() && (!enterprise || isEnterpriseActivated()),
    onChange: (config) => deps.onRemoteModelConfig(config),
    readStored: () => readRemoteModelConfig(),
    writeStored: (config) => writeRemoteModelConfig(config),
  })

  // Both editions report, so the fleet's version distribution is visible server-side.
  const deviceReport = new BackendUpload({
    backend,
    isActivated: enterprise ? isEnterpriseActivated : () => true,
    job: deviceReportJob({
      getVersion: () => app.getVersion(),
      getKeySource: () => {
        const { source } = vendorCredentials.getStatus(settings.get().activeVendor)
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
    isActivated: isEnterpriseActivated,
    isSyncEnabled: () => settings.get().remoteSyncEnabled,
  }
  const databaseUpload = enterprise
    ? new BackendUpload({
        ...uploads,
        job: databaseUploadJob({
          backend,
          getDbPath: () => storage.getDbPath(),
          backupToFile: (destinationPath) => storage.backupToFile(destinationPath),
          hasActivitiesEndedAfter: (ts) => storage.activities.hasEndedAfter(ts),
          getLastSnapshotAt: () => storage.uploadRuns.getLastRunTimestamp(),
          recordSnapshotAt: (ts) => storage.uploadRuns.record(ts),
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
        isActivated: isEnterpriseActivated,
        onChange: (blacklist) => {
          deps.onManagedExclusions(blacklist)
          managedExclusionsChanged.emit()
        },
        readStored: () => readRemoteBlacklist(),
        writeStored: (blacklist) => writeRemoteBlacklist(blacklist),
      })
    : null

  let unsubscribeSettings = (): void => {}
  const kick = (reason: string): void => {
    databaseUpload?.kick(reason)
    logUpload?.kick(reason)
  }

  return {
    access,
    isEnterpriseActivated,
    requiresActivation: () => requiresActivation(access.getAccessState()),
    remoteModels,
    databaseUpload,
    logUpload,
    getManagedExclusions: () => remoteBlacklist?.getBlacklist() ?? { apps: [], urlPatterns: [] },
    onManagedExclusionsChanged: managedExclusionsChanged.add,
    kick,
    start(): void {
      remoteModels.start()
      deviceReport.start()
      databaseUpload?.start()
      logUpload?.start()
      remoteBlacklist?.start()

      let activated = isEnterpriseActivated()
      access.addUpdateListener((state) => {
        if (state.isEnterpriseActivated === activated) return
        activated = state.isEnterpriseActivated
        if (!activated) return
        kick('activated')
        deviceReport.kick('activated')
      })
      host.onAwake(() => kick('resume'))
      unsubscribeSettings = settings.onChange((next, previous) => {
        if (!previous.remoteSyncEnabled && next.remoteSyncEnabled) {
          kick('sharing enabled')
        }
      })
      access.startPeriodicRefresh()
    },
    stop(): Array<[name: string, step: Promise<void>]> {
      unsubscribeSettings()
      access.stopPeriodicRefresh()
      const jobs = { remoteModels, deviceReport, databaseUpload, logUpload, remoteBlacklist }
      return Object.entries(jobs).flatMap(([name, job]) =>
        job ? [[`${name}.stop`, job.stop()] as [string, Promise<void>]] : [],
      )
    },
  }
}
