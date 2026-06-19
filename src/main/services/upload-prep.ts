import { app, utilityProcess } from 'electron'
import * as path from 'path'
import type { StripOptions } from './strip-database-for-upload'
import type { UploadPrepRequest, UploadPrepResponse } from './upload-prep-worker'

// Built alongside index.js (see electron.vite.config.ts rollup input).
// app.getAppPath() resolves to the asar root when packaged and to the project
// root in dev, so the same relative layout works for both.
function workerScriptPath(): string {
  return path.join(app.getAppPath(), 'out', 'main', 'upload-prep-worker.js')
}

// Generous upper bound for strip + VACUUM + gzip. If the worker exceeds this it
// is almost certainly hung; we kill it and reject so a stuck child can't leave
// the upload `inFlight` promise unresolved (which would wedge every later run).
const WORKER_TIMEOUT_MS = 2 * 60 * 1000

/**
 * Run the upload prep (strip + VACUUM + gzip) in a short-lived utilityProcess
 * so the heavy synchronous SQLite work never blocks the main thread. The child
 * is killed once it returns the compressed buffer (or fails).
 */
export function prepareUploadInWorker(
  tempPath: string,
  stripOptions: StripOptions,
): Promise<Buffer> {
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

    child.on('message', (msg: UploadPrepResponse) => {
      if (msg.ok) settle(() => resolve(Buffer.from(msg.gzip)))
      else settle(() => reject(new Error(msg.error)))
    })

    child.on('exit', (code) => {
      settle(() => reject(new Error(`upload-prep worker exited before responding (code ${code})`)))
    })

    // Send the task once the child is ready to receive messages.
    child.once('spawn', () => {
      const req: UploadPrepRequest = { tempPath, stripOptions }
      child.postMessage(req)
    })
  })
}
