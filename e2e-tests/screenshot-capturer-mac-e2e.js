#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { createInterface } = require('readline')

const WATCH_DURATION_MS = 10_000
const OUTPUT_ROOT_DIR = path.resolve(process.cwd(), '.debug-screenshot-capturer-mac')
const RUN_OUTPUT_DIR = path.join(OUTPUT_ROOT_DIR, new Date().toISOString().replace(/[:.]/g, '-'))
const FRAMES_DIR = path.join(RUN_OUTPUT_DIR, 'frames')
const RUN_BINARY_PATH = path.join(RUN_OUTPUT_DIR, 'screenshot-capturer-mac')
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function resolveBinaryPath() {
  const override = process.env.MEMORYLANE_SCREENSHOT_CAPTURER_MAC_EXECUTABLE
  if (override) {
    return override
  }
  return path.resolve(process.cwd(), 'build', 'rust', 'screenshot-capturer-mac')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function terminateChild(child, closePromise) {
  if (child.exitCode !== null || child.signalCode !== null) {
    await closePromise
    return
  }

  child.kill('SIGTERM')
  await Promise.race([closePromise, sleep(2000)])
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }

  child.kill('SIGKILL')
  await Promise.race([closePromise, sleep(2000)])
}

function writeJsonLines(pathname, records) {
  const payload =
    records.length > 0 ? `${records.map((record) => JSON.stringify(record)).join('\n')}\n` : ''
  fs.writeFileSync(pathname, payload, 'utf8')
}

function assertPng(pathname) {
  if (!fs.existsSync(pathname)) {
    throw new Error(`Expected PNG file does not exist: ${pathname}`)
  }
  const bytes = fs.readFileSync(pathname)
  if (bytes.length <= PNG_SIGNATURE.length) {
    throw new Error(`PNG file is unexpectedly small: ${pathname}`)
  }
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error(`Invalid PNG signature: ${pathname}`)
  }
}

function assertResults(summary, screenshotEvents) {
  if (summary.readyCount <= 0) {
    throw new Error('Expected at least one ready event.')
  }
  if (summary.screenshotSavedCount <= 0) {
    throw new Error('Expected at least one screenshot_saved event.')
  }
  if (summary.errorCount !== 0) {
    throw new Error(`Sidecar emitted ${summary.errorCount} error event(s).`)
  }
  if (summary.parseErrorCount !== 0) {
    throw new Error(`Encountered ${summary.parseErrorCount} parse error(s).`)
  }

  for (const event of screenshotEvents) {
    if (!Number.isInteger(event.displayId) || event.displayId <= 0) {
      throw new Error(`Invalid displayId in screenshot event: ${JSON.stringify(event)}`)
    }
    assertPng(event.filepath)
  }
}

async function main() {
  if (process.platform !== 'darwin') {
    console.error('[ScreenshotCapturerMacE2E] This test must run on darwin.')
    process.exit(1)
  }
  if (process.env.RUN_MAC_SCREENSHOT_CAPTURER_E2E !== '1') {
    console.error('[ScreenshotCapturerMacE2E] RUN_MAC_SCREENSHOT_CAPTURER_E2E=1 is required.')
    process.exit(1)
  }

  const sidecarBinaryPath = resolveBinaryPath()
  if (!fs.existsSync(sidecarBinaryPath)) {
    throw new Error(
      `Missing mac screenshot sidecar at ${sidecarBinaryPath}. Run "npm run build:rust" first.`,
    )
  }

  fs.mkdirSync(FRAMES_DIR, { recursive: true })
  fs.copyFileSync(sidecarBinaryPath, RUN_BINARY_PATH)
  fs.chmodSync(RUN_BINARY_PATH, 0o755)

  const allEvents = []
  const screenshotEvents = []
  const parseErrors = []

  const child = spawn(RUN_BINARY_PATH, ['--output-dir', FRAMES_DIR, '--interval-ms', '1000'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  console.log(`[ScreenshotCapturerMacE2E] Spawned sidecar pid=${child.pid}`)

  const rl = createInterface({ input: child.stdout })
  rl.on('line', (line) => {
    let event
    try {
      event = JSON.parse(line)
    } catch {
      parseErrors.push(line)
      return
    }

    allEvents.push(event)
    if (event.type === 'screenshot_saved') {
      screenshotEvents.push(event)
    }
  })

  const stderrLines = []
  child.stderr.on('data', (chunk) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    const trimmed = text.trim()
    if (trimmed.length > 0) {
      stderrLines.push(trimmed)
    }
  })

  let closeCode = null
  let closeSignal = null
  const closePromise = new Promise((resolve) => {
    child.on('close', (code, signal) => {
      closeCode = code
      closeSignal = signal
      resolve()
    })
  })
  child.on('error', (error) => {
    stderrLines.push(`spawn error: ${error.message}`)
  })

  await sleep(WATCH_DURATION_MS)
  await terminateChild(child, closePromise)
  rl.close()

  const summary = {
    eventCount: allEvents.length,
    readyCount: allEvents.filter((event) => event.type === 'ready').length,
    displayChangeCount: allEvents.filter((event) => event.type === 'display_change').length,
    screenshotSavedCount: allEvents.filter((event) => event.type === 'screenshot_saved').length,
    errorCount: allEvents.filter((event) => event.type === 'error').length,
    parseErrorCount: parseErrors.length,
    parseErrors,
    processCloseCode: closeCode,
    processCloseSignal: closeSignal,
    processStderr: stderrLines,
  }

  writeJsonLines(path.join(RUN_OUTPUT_DIR, 'sidecar-events.jsonl'), allEvents)
  writeJsonLines(path.join(RUN_OUTPUT_DIR, 'screenshot-events.jsonl'), screenshotEvents)
  fs.writeFileSync(
    path.join(RUN_OUTPUT_DIR, 'summary.json'),
    JSON.stringify(summary, null, 2),
    'utf8',
  )

  try {
    assertResults(summary, screenshotEvents)
    console.log(`[ScreenshotCapturerMacE2E] Saved artifacts in: ${RUN_OUTPUT_DIR}`)
    process.exit(0)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[ScreenshotCapturerMacE2E] FAILED: ${message}`)
    console.error(`[ScreenshotCapturerMacE2E] Artifacts: ${RUN_OUTPUT_DIR}`)
    process.exit(1)
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error(`[ScreenshotCapturerMacE2E] Fatal error: ${message}`)
  process.exit(1)
})
