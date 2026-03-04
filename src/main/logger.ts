interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

let log: Logger

if (process.env.MEMORYLANE_SILENT_LOGGER === '1') {
  const noop = (): void => undefined
  log = { debug: noop, info: noop, warn: noop, error: noop }
} else
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electronLog = require('electron-log/main')
    const isDev = process.env.NODE_ENV === 'development'
    const level = isDev ? 'debug' : 'info'
    console.log(`[Logger] Setting level to ${level}`)
    electronLog.transports.file.level = isDev ? false : level
    electronLog.transports.console.level = level
    electronLog.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}'
    log = electronLog
  } catch {
    // Fallback for ELECTRON_RUN_AS_NODE mode where electron-log can't load.
    // All output goes to stderr (stdout is reserved for MCP protocol).
    const write = (...args: unknown[]): void => {
      process.stderr.write(args.map(String).join(' ') + '\n')
    }
    log = { debug: write, info: write, warn: write, error: write }
  }

export default log
