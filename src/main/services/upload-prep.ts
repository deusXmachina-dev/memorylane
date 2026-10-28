import { app, utilityProcess } from 'electron'
import * as path from 'path'
import { isWorkerLogEvent, logWorkerEvent, type WorkerLogEvent } from '@main/utils/worker-log'
import type { UploadPrepRequest, UploadPrepResponse } from './upload-prep-worker'

// Built alongside index.js (see electron.vite.config.ts rollup input).
// app.getAppPath() resolves to the asar root when packaged and to the project
// root in dev, so the same relative layout works for both.
function workerScriptPath(): string {
  return path.join(app.getAppPath(), 'out', 'main', 'upload-prep-worker.js')
}

// If the worker exceeds this it is almost certainly hung; we kill it and reject
// so a stuck child can't leave the upload `inFlight` promise unresolved.
const WORKER_TIMEOUT_MS = 2 * 60 * 1000

export function prepareUploadInWorker(req: UploadPrepRequest): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const child = utilityProcess.fork(workerScriptPath(), [], { serviceName: 'upload-prep' })
    let settled = false

    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
      child.kill()
    }

    const timer = setTimeout(() => {
      settle(() => reject(new Error(`upload-prep worker timed out after ${WORKER_TIMEOUT_MS}ms`)))
    }, WORKER_TIMEOUT_MS)
    timer.unref?.()

    child.on('message', (msg: UploadPrepResponse | WorkerLogEvent) => {
      if (isWorkerLogEvent(msg)) return logWorkerEvent('UploadPrep', msg)
      if (msg.ok) settle(() => resolve(Buffer.from(msg.gzip)))
      else settle(() => reject(new Error(msg.error)))
    })

    child.on('exit', (code) => {
      settle(() => reject(new Error(`upload-prep worker exited before responding (code ${code})`)))
    })

    child.once('spawn', () => {
      child.postMessage(req)
    })
  })
}
