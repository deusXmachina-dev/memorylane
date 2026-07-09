import * as util from 'util'
import log, { setLogger } from '@main/utils/logger'

/**
 * Log forwarding for utilityProcess workers. A worker has no electron-log —
 * its console goes to inherited stdio, which is lost in packaged builds — so
 * the worker rides its log calls over the existing parentPort channel and the
 * client prints them through the main-process logger (one file writer).
 */

const LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type WorkerLogLevel = (typeof LEVELS)[number]

export interface WorkerLogEvent {
  kind: 'worker-log'
  level: WorkerLogLevel
  args: string[]
}

export function isWorkerLogEvent(message: unknown): message is WorkerLogEvent {
  const event = message as WorkerLogEvent | null
  return (
    typeof event === 'object' &&
    event !== null &&
    event.kind === 'worker-log' &&
    LEVELS.includes(event.level) &&
    Array.isArray(event.args)
  )
}

/** Worker side: reroute this process's `log` calls to the parent. Call once
 * at worker startup. */
export function forwardLogsToParent(port: { postMessage(message: WorkerLogEvent): void }): void {
  const send =
    (level: WorkerLogLevel) =>
    (...args: unknown[]) => {
      port.postMessage({ kind: 'worker-log', level, args: args.map(serialize) })
    }
  setLogger({ debug: send('debug'), info: send('info'), warn: send('warn'), error: send('error') })
}

/** Main side: print a forwarded worker log event, tagged with the worker name. */
export function logWorkerEvent(tag: string, event: WorkerLogEvent): void {
  log[event.level](`[${tag}]`, ...event.args)
}

// Errors keep their stack — recovering worker-side stacks is the point.
function serialize(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return arg.stack ?? String(arg)
  return util.inspect(arg)
}
