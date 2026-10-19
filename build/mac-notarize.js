/* eslint-disable @typescript-eslint/no-var-requires */
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { notarize } = require('@electron/notarize')

const STAPLE_ATTEMPTS = 10
const STAPLE_DELAY_MS = 30_000
const NOTARIZE_ATTEMPTS = 3
const NOTARIZE_DELAY_MS = 60_000

const deps = {
  notarize,
  execFile: promisify(execFile),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

function lastLine(err) {
  const text = `${err.stderr || ''}${err.stdout || ''}${err.message || ''}`.trim()
  return text.split('\n').pop()
}

async function staple(appPath) {
  for (let attempt = 1; ; attempt++) {
    try {
      await deps.execFile('xcrun', ['stapler', 'staple', '-v', appPath])
      return
    } catch (err) {
      if (attempt >= STAPLE_ATTEMPTS) throw err
      console.log(`Staple failed (attempt ${attempt}/${STAPLE_ATTEMPTS}): ${lastLine(err)}`)
      await deps.sleep(STAPLE_DELAY_MS)
    }
  }
}

async function notarizeWithRetry(opts) {
  for (let attempt = 1; ; attempt++) {
    try {
      await deps.notarize(opts)
      return
    } catch (err) {
      if (/Failed to staple/.test(err.message)) {
        console.log(`Notarized but staple failed, retrying staple: ${lastLine(err)}`)
        await staple(opts.appPath)
        return
      }
      if (attempt >= NOTARIZE_ATTEMPTS) throw err
      console.log(`Notarization failed (attempt ${attempt}/${NOTARIZE_ATTEMPTS}): ${lastLine(err)}`)
      await deps.sleep(NOTARIZE_DELAY_MS)
    }
  }
}

module.exports = { notarizeWithRetry, deps }
