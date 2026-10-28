import log from '@main/utils/logger'
import { isSameDay } from '@main/utils/day'
import { BACKEND_REQUEST_TIMEOUT_MS } from '@/shared/constants'
import type { BackendClient } from './backend-client'
import type { Slice, UploadPrepRequest } from './upload-prep-worker'
import { fileForm, type UploadJob } from './backend-upload'

export const SLICE_PAGE_SIZE = 20_000
export const SLICE_OVERLAP_MS = 60 * 60 * 1000

export type PrepareUpload = (req: UploadPrepRequest) => Promise<Slice>

const defaultPrepareUpload: PrepareUpload = async (req) => {
  const { prepareUploadInWorker } = await import('./upload-prep')
  return prepareUploadInWorker(req)
}

interface SyncState {
  format: 'delta-v1' | 'snapshot'
  lastEndTs: number | null
}

export interface DatabaseUploadJobParams {
  backend: Pick<BackendClient, 'request'>
  getDbPath: () => string
  backupToFile: (destinationPath: string) => Promise<void>
  getLastUploadAt: () => number | null
  recordUploadAt: (ts: number) => void
  prepareUpload?: PrepareUpload
}

export function databaseUploadJob(params: DatabaseUploadJobParams): UploadJob {
  const prepareUpload = params.prepareUpload ?? defaultPrepareUpload
  let pending: { count: number; more: boolean } | null = null

  async function fetchSyncState(): Promise<SyncState> {
    const response = await params.backend.request('api/device/sync-state', {
      timeoutMs: BACKEND_REQUEST_TIMEOUT_MS,
    })
    if (response.status === 404) return { format: 'snapshot', lastEndTs: null }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Sync state failed (${response.status}): ${text}`)
    }
    const data = (await response.json()) as { format?: string; last_end_ts?: number | null }
    return {
      format: data.format === 'delta-v1' ? 'delta-v1' : 'snapshot',
      lastEndTs: data.last_end_ts ?? null,
    }
  }

  return {
    name: 'DatabaseUpload',
    endpoint: 'api/device/upload',
    skipReason() {
      const lastUploadAt = params.getLastUploadAt()
      if (lastUploadAt !== null && isSameDay(lastUploadAt, Date.now())) {
        return 'already uploaded today'
      }
      return null
    },
    async produce(tempPath) {
      const { format, lastEndTs } = await fetchSyncState()

      if (format === 'snapshot') {
        await params.backupToFile(tempPath)
        const { gzip, count } = await prepareUpload({ kind: 'snapshot', path: tempPath })
        pending = { count, more: false }
        return fileForm(gzip, 'memorylane.db.gz')
      }

      const { gzip, count } = await prepareUpload({
        kind: 'slice',
        dbPath: params.getDbPath(),
        outPath: tempPath,
        sinceTs: lastEndTs === null ? 0 : lastEndTs - SLICE_OVERLAP_MS,
        pageSize: SLICE_PAGE_SIZE,
      })
      pending = { count, more: count === SLICE_PAGE_SIZE }

      const form = new FormData()
      form.append('format', 'delta-v1')
      form.append('file', new Blob([gzip]), 'slice.db.gz')
      return form
    },
    async onSuccess() {
      const sent = pending
      pending = null
      if (sent === null) return false
      if (!sent.more) params.recordUploadAt(Date.now())
      log.info(`[DatabaseUpload] sent ${sent.count} activities`)
      return sent.more
    },
  }
}
