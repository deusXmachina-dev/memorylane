import { app } from 'electron'
import * as path from 'path'
import { setLogger } from './logger'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronLog = require('electron-log/main')
const isDev = !app.isPackaged
// Dev logs at debug, packaged at info. Override with MEMORYLANE_LOG_LEVEL to
// simulate the production filter locally — e.g. `MEMORYLANE_LOG_LEVEL=info
// npm run dev` raises the console (and the dev file, when MEMORYLANE_DEV_FILE_LOG
// is also set) to the prod stream, so you can see what packaged builds record.
const level = process.env.MEMORYLANE_LOG_LEVEL ?? (isDev ? 'debug' : 'info')

// File logging is normally off in dev (console is primary). Enable it when
// debugging the pipeline so the run's logs — including otherwise console-only
// extractor dead-letters — are captured to a file for inspection, written next
// to the dev DB and screenshots. Packaged builds always log to file.
const devFileLogging =
  isDev && Boolean(process.env.DEBUG_PIPELINE || process.env.MEMORYLANE_DEV_FILE_LOG)

electronLog.transports.file.level = isDev ? (devFileLogging ? level : false) : level
electronLog.transports.console.level = level
electronLog.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}'

if (devFileLogging) {
  electronLog.transports.file.resolvePathFn = (): string =>
    path.join(app.getPath('userData'), 'memorylane-dev.log')
}

setLogger(electronLog)
