const log = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
}

export function setLogger(logger: Partial<typeof log>): void {
  Object.assign(log, logger)
}

export default log
