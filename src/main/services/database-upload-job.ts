import * as fs from 'fs'
import { isSameDay } from '@main/utils/day'
import { BACKEND_REQUEST_TIMEOUT_MS } from '@/shared/constants'
import type { BackendClient } from './backend-client'
import type { UploadPrepRequest } from './upload-prep-worker'
import { fileForm, type UploadJob } from './backend-upload'

export const DELTA_OVERLAP_MS = 60 * 60 * 1000

export type PrepareUpload = (req: UploadPrepRequest) => Promise<Buffer>

const defaultPrepareUpload: PrepareUpload = async (req) => {
  const { prepareUploadInWorker } = await import('./upload-prep')
  return prepareUploadInWorker(req)
}

export interface DatabaseUploadJobParams {
  backend: Pick<BackendClient, 'request'>
  getDbPath: () => string
  backupToFile: (destinationPath: string) => Promise<void>
  getLastUploadAt: () => number | null
  recordUploadAt: (ts: number) => void
  getResetRequestedAt: () => number | null
  clearResetRequest: () => void
  prepareUpload?: PrepareUpload
}

export function databaseUploadJob(params: DatabaseUploadJobParams): UploadJob {
  const prepareUpload = params.prepareUpload ?? defaultPrepareUpload
  let format: 'delta-v1' | 'snapshot' = 'snapshot'

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

  async function fetchLastEndTs(): Promise<number | null | 'snapshot'> {
    const response = await params.backend.request('api/device/data/state', {
      timeoutMs: BACKEND_REQUEST_TIMEOUT_MS,
    })
    if (response.status === 404 || response.status === 409) return 'snapshot'
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Sync state failed (${response.status}): ${text}`)
    }
    const data = (await response.json()) as { last_end_ts?: number | null }
    return data.last_end_ts ?? null
  }

  async function snapshot(tempPath: string): Promise<BodyInit> {
    format = 'snapshot'
    fs.rmSync(tempPath, { force: true })
    await params.backupToFile(tempPath)
    return fileForm(await prepareUpload({ kind: 'snapshot', path: tempPath }), 'memorylane.db.gz')
  }

  return {
    name: 'DatabaseUpload',
    get endpoint() {
      return format === 'delta-v1' ? 'api/device/data' : 'api/device/upload'
    },
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
      if (lastEndTs === 'snapshot') return snapshot(tempPath)

      format = 'delta-v1'
      const gzip = await prepareUpload({
        kind: 'delta',
        dbPath: params.getDbPath(),
        outPath: tempPath,
        sinceTs: lastEndTs === null ? 0 : lastEndTs - DELTA_OVERLAP_MS,
      })
      const form = fileForm(gzip, 'delta.db.gz')
      form.append('format', 'delta-v1')
      return form
    },
    async fallback(response, tempPath) {
      if (format !== 'delta-v1') return null
      if (response.status !== 404 && response.status !== 409) return null
      return snapshot(tempPath)
    },
    async onSuccess(response) {
      if (format === 'delta-v1' && response.status !== 201) {
        throw new Error(`Delta upload returned ${response.status}, expected 201`)
      }
      params.recordUploadAt(Date.now())
    },
  }
}
