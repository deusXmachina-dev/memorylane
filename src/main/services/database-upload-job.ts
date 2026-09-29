import log from '@main/utils/logger'
import { isSameDay } from '@main/utils/day'
import type { StripOptions } from './strip-database-for-upload'
import type { UploadJob } from './backend-upload'

export type PrepareUpload = (tempPath: string, stripOptions: StripOptions) => Promise<Buffer>

const defaultPrepareUpload: PrepareUpload = async (tempPath, stripOptions) => {
  const { prepareUploadInWorker } = await import('./upload-prep')
  return prepareUploadInWorker(tempPath, stripOptions)
}

export interface DatabaseUploadStorage {
  backupToFile(destinationPath: string): Promise<void>
}

export interface DatabaseUploadJobParams {
  storage: DatabaseUploadStorage
  getStripOptions: () => StripOptions
  getLastUploadAt: () => number | null
  recordUploadAt: (ts: number) => void
  prepareUpload?: PrepareUpload
}

export function databaseUploadJob(params: DatabaseUploadJobParams): UploadJob {
  const prepareUpload = params.prepareUpload ?? defaultPrepareUpload
  return {
    name: 'DatabaseUpload',
    endpoint: 'api/device/upload',
    filename: 'memorylane.db.gz',
    skipReason() {
      const lastUploadAt = params.getLastUploadAt()
      if (lastUploadAt !== null && isSameDay(lastUploadAt, Date.now())) {
        return 'already uploaded today'
      }
      return null
    },
    async produce(tempPath) {
      await params.storage.backupToFile(tempPath)
      return prepareUpload(tempPath, params.getStripOptions())
    },
    async onSuccess(response) {
      const data = (await response.json()) as { upload_id: string; checksum_sha256: string }
      params.recordUploadAt(Date.now())
      log.info(`[DatabaseUpload] upload_id=${data.upload_id} checksum=${data.checksum_sha256}`)
    },
  }
}
