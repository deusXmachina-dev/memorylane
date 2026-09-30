import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import * as path from 'path'
import { LOG_UPLOAD_MIN_INTERVAL_MS } from '@/shared/constants'
import { collectSupportBundleFiles } from '@main/ui/logs-export'
import { createZipWithFiles } from '@main/ui/zip'
import type { LogUploadState } from './log-upload-store'
import type { UploadJob } from './backend-upload'

export type ZipLogFiles = (files: string[], outputPath: string) => Promise<void>

export interface LogUploadJobParams {
  readState: () => LogUploadState | null
  writeState: (state: LogUploadState) => void
  collectFiles?: () => string[]
  zipFiles?: ZipLogFiles
  minIntervalMs?: number
  now?: () => number
}

function computeSignature(files: string[]): string {
  return files
    .map((file) => {
      try {
        const stat = fs.statSync(file)
        return `${path.basename(file)}:${stat.size}:${Math.round(stat.mtimeMs)}`
      } catch {
        return `${path.basename(file)}:missing`
      }
    })
    .sort()
    .join('|')
}

export function logUploadJob(params: LogUploadJobParams): UploadJob {
  const collectFiles = params.collectFiles ?? collectSupportBundleFiles
  const zipFiles =
    params.zipFiles ?? ((files, out) => createZipWithFiles(files, out, { snapshot: true }))
  const minIntervalMs = params.minIntervalMs ?? LOG_UPLOAD_MIN_INTERVAL_MS
  const now = params.now ?? Date.now
  let pendingSig: string | null = null

  return {
    name: 'LogUpload',
    endpoint: 'api/device/logs',
    filename: 'memorylane-logs.zip',
    skipReason() {
      const files = collectFiles()
      if (files.length === 0) return 'no log files'
      const state = params.readState()
      if (state?.lastSig === computeSignature(files)) return 'logs unchanged since last upload'
      if (state?.lastUploadAt != null && now() - state.lastUploadAt < minIntervalMs) {
        return 'throttled (uploaded recently)'
      }
      return null
    },
    async produce(tempPath) {
      const files = collectFiles()
      if (files.length === 0) throw new Error('No log files found')
      pendingSig = computeSignature(files)
      await zipFiles(files, tempPath)
      return fsPromises.readFile(tempPath)
    },
    async onSuccess() {
      params.writeState({ lastUploadAt: now(), lastSig: pendingSig })
    },
  }
}
