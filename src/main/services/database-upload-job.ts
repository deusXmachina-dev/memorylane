import { isSameDay } from '@main/utils/day'
import { BACKEND_REQUEST_TIMEOUT_MS } from '@/shared/constants'
import type { BackendClient } from './backend-client'
import type { DeltaRequest } from './upload-prep-worker'
import { fileForm, type UploadJob } from './backend-upload'

export const DELTA_OVERLAP_MS = 60 * 60 * 1000

export type PrepareUpload = (req: DeltaRequest) => Promise<Buffer>

const defaultPrepareUpload: PrepareUpload = async (req) => {
  const { prepareUploadInWorker } = await import('./upload-prep')
  return prepareUploadInWorker(req)
}

export interface DatabaseUploadJobParams {
  backend: Pick<BackendClient, 'request'>
  getDbPath: () => string
  getLastUploadAt: () => number | null
  recordUploadAt: (ts: number) => void
  getResetRequestedAt: () => number | null
  clearResetRequest: () => void
  prepareUpload?: PrepareUpload
}

export function databaseUploadJob(params: DatabaseUploadJobParams): UploadJob {
  const prepareUpload = params.prepareUpload ?? defaultPrepareUpload

  async function deleteServerData(): Promise<void> {
    const resetAt = params.getResetRequestedAt()
    if (resetAt === null) return
    const response = await params.backend.request('api/device/data', {
      method: 'DELETE',
      timeoutMs: BACKEND_REQUEST_TIMEOUT_MS,
    })
    if (!response.ok && response.status !== 404) {
      const text = await response.text().catch(() => '')
      throw new Error(`Data reset failed (${response.status}): ${text}`)
    }
    if (params.getResetRequestedAt() === resetAt) params.clearResetRequest()
  }

  async function fetchLastEndTs(): Promise<number | null> {
    const response = await params.backend.request('api/device/data/state', {
      timeoutMs: BACKEND_REQUEST_TIMEOUT_MS,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Sync state failed (${response.status}): ${text}`)
    }
    const data = (await response.json()) as { last_end_ts?: number | null }
    return data.last_end_ts ?? null
  }

  return {
    name: 'DatabaseUpload',
    endpoint: 'api/device/data',
    skipReason() {
      const lastUploadAt = params.getLastUploadAt()
      if (lastUploadAt !== null && isSameDay(lastUploadAt, Date.now())) {
        return 'already uploaded today'
      }
      return null
    },
    async produce(tempPath) {
      await deleteServerData()
      const lastEndTs = await fetchLastEndTs()
      const gzip = await prepareUpload({
        dbPath: params.getDbPath(),
        outPath: tempPath,
        sinceTs: lastEndTs === null ? 0 : lastEndTs - DELTA_OVERLAP_MS,
      })
      return fileForm(gzip, 'delta.db.gz')
    },
    async onSuccess() {
      params.recordUploadAt(Date.now())
    },
  }
}
