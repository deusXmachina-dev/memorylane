import { app } from 'electron'
import { setLogger } from './logger'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronLog = require('electron-log/main')
const isDev = !app.isPackaged
const level = isDev ? 'debug' : 'info'

electronLog.transports.file.level = isDev ? false : level
electronLog.transports.console.level = level
electronLog.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}'

setLogger(electronLog)
