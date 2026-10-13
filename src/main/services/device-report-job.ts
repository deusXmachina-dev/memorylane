import log from '@main/utils/logger'
import { backendPlatformToken } from '@main/utils/platform'
import type { AppEdition } from '@/shared/edition'
import { BACKEND_REQUEST_TIMEOUT_MS } from '@/shared/constants'
import type { DeviceReportState, KeySource } from './device-report-store'
import type { UploadJob } from './backend-upload'

export interface DeviceReportJobParams {
  getVersion: () => string
  getKeySource: () => KeySource
  edition: AppEdition
  readStored: () => DeviceReportState | null
  writeStored: (state: DeviceReportState) => void
}

/** Reports the running version and key source, once per change. */
export function deviceReportJob(params: DeviceReportJobParams): UploadJob {
  let lastReported: DeviceReportState | null | undefined
  let pending: DeviceReportState | null = null

  return {
    name: 'DeviceReport',
    endpoint: 'api/device/report',
    timeoutMs: BACKEND_REQUEST_TIMEOUT_MS,
    skipReason() {
      lastReported ??= params.readStored()
      const version = params.getVersion()
      const keySource = params.getKeySource()
      if (version === lastReported?.version && keySource === lastReported.keySource) {
        return 'already reported'
      }
      return null
    },
    async produce() {
      pending = { version: params.getVersion(), keySource: params.getKeySource() }
      const body = {
        app_version: pending.version,
        platform: backendPlatformToken(),
        key_source: pending.keySource,
      }
      return new Blob([JSON.stringify(body)], { type: 'application/json' })
    },
    async onSuccess() {
      if (!pending) return
      lastReported = pending
      params.writeStored(pending)
      log.info(
        `[DeviceReport] Reported version ${pending.version}, key ${pending.keySource} (${params.edition})`,
      )
    },
  }
}
