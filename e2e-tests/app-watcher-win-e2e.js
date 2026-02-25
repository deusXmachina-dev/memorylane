#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { createInterface } = require('readline')
const { app, screen } = require('electron')

const WATCH_DURATION_MS = 2500
const OUTPUT_ROOT_DIR = path.resolve(process.cwd(), '.debug-app-watcher-win')
const RUN_OUTPUT_DIR = path.join(OUTPUT_ROOT_DIR, new Date().toISOString().replace(/[:.]/g, '-'))

function exitWithCode(code) {
  if (app && typeof app.exit === 'function') {
    app.exit(code)
    return
  }
  process.exit(code)
}

function resolveWatcherBinaryPath() {
  const override = process.env.MEMORYLANE_APP_WATCHER_WIN_EXECUTABLE
  if (override) {
    return override
  }
  return path.resolve(process.cwd(), 'build', 'rust', 'app-watcher-windows.exe')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function writeJsonLines(pathname, records) {
  const payload =
    records.length > 0 ? `${records.map((record) => JSON.stringify(record)).join('\n')}\n` : ''
  fs.writeFileSync(pathname, payload, 'utf8')
}

function resolveDisplay(event) {
  if (event.displayId !== undefined) {
    return { displayId: event.displayId, source: 'event_display_id' }
  }

  if (event.windowBounds) {
    const rect = {
      x: event.windowBounds.x,
      y: event.windowBounds.y,
      width: event.windowBounds.width,
      height: event.windowBounds.height,
    }

    if (rect.width > 0 && rect.height > 0) {
      const dipRect = process.platform === 'win32' ? screen.screenToDipRect(null, rect) : rect
      const matched = screen.getDisplayMatching(dipRect)
      if (matched && matched.id !== undefined && matched.id !== null) {
        return { displayId: matched.id, source: 'window_bounds' }
      }
    }
  }

  const cursorPoint = screen.getCursorScreenPoint()
  const cursorDisplay = screen.getDisplayNearestPoint(cursorPoint)
  return { displayId: cursorDisplay.id, source: 'cursor_fallback' }
}

function assertE2EResults(summary, interactionEvents) {
  if (summary.readyCount <= 0) {
    throw new Error('Expected at least one ready event.')
  }
  if (summary.appChangeCount + summary.windowChangeCount <= 0) {
    throw new Error('Expected at least one app/window change event.')
  }
  if (interactionEvents.length <= 0) {
    throw new Error('Expected at least one interaction event.')
  }
  if (summary.resolutionErrorCount !== 0) {
    throw new Error(`Display resolution errors detected: ${summary.resolutionErrorCount}`)
  }
  if (summary.errorCount !== 0) {
    throw new Error(`Watcher emitted ${summary.errorCount} error events.`)
  }

  const invalidDisplay = interactionEvents.find(
    (event) => !Number.isInteger(event.displayId) || event.displayId <= 0,
  )
  if (invalidDisplay) {
    throw new Error(
      `Invalid displayId detected in interaction event: ${JSON.stringify(invalidDisplay)}`,
    )
  }
}

async function main() {
  if (process.platform !== 'win32') {
    console.error('[AppWatcherWindowsE2E] This test must run on win32.')
    process.exit(1)
  }
  if (process.env.RUN_WINDOWS_E2E !== '1') {
    console.error('[AppWatcherWindowsE2E] RUN_WINDOWS_E2E=1 is required.')
    process.exit(1)
  }

  await app.whenReady()

  if (!screen) {
    throw new Error('Electron screen API is unavailable in E2E runner.')
  }

  const watcherBinaryPath = resolveWatcherBinaryPath()
  if (!fs.existsSync(watcherBinaryPath)) {
    throw new Error(
      `Missing Windows watcher sidecar at ${watcherBinaryPath}. Run "npm run build:rust" first.`,
    )
  }

  fs.mkdirSync(RUN_OUTPUT_DIR, { recursive: true })

  const watcherEvents = []
  const interactionEvents = []
  const resolutionErrors = []
  const parseErrors = []

  const child = spawn(watcherBinaryPath, [], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  console.log(`[AppWatcherWindowsE2E] Spawned watcher pid=${child.pid}`)

  const rl = createInterface({ input: child.stdout })
  rl.on('line', (line) => {
    let event
    try {
      event = JSON.parse(line)
    } catch {
      parseErrors.push(line)
      return
    }

    watcherEvents.push(event)
    if (event.type !== 'app_change' && event.type !== 'window_change') {
      return
    }

    try {
      const resolved = resolveDisplay(event)
      interactionEvents.push({
        type: 'app_change',
        timestamp: event.timestamp,
        displayId: resolved.displayId,
        activeWindow: {
          processName: event.app ?? '',
          title: event.title ?? '',
        },
        resolutionSource: resolved.source,
      })
    } catch (error) {
      resolutionErrors.push(error instanceof Error ? error.message : String(error))
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

  await sleep(WATCH_DURATION_MS)
  if (!child.killed) {
    child.kill('SIGTERM')
  }
  await Promise.race([closePromise, sleep(5000)])
  rl.close()

  const summary = {
    eventCount: watcherEvents.length,
    readyCount: watcherEvents.filter((event) => event.type === 'ready').length,
    appChangeCount: watcherEvents.filter((event) => event.type === 'app_change').length,
    windowChangeCount: watcherEvents.filter((event) => event.type === 'window_change').length,
    errorCount: watcherEvents.filter((event) => event.type === 'error').length,
    firstTimestamp: watcherEvents[0] ? watcherEvents[0].timestamp : null,
    lastTimestamp: watcherEvents[watcherEvents.length - 1]
      ? watcherEvents[watcherEvents.length - 1].timestamp
      : null,
    resolutionErrorCount: resolutionErrors.length,
    resolutionErrors,
    parseErrorCount: parseErrors.length,
    parseErrors,
    fallbackUsage: interactionEvents.reduce(
      (acc, event) => {
        acc[event.resolutionSource]++
        return acc
      },
      {
        event_display_id: 0,
        window_bounds: 0,
        cursor_fallback: 0,
      },
    ),
    processCloseCode: closeCode,
    processCloseSignal: closeSignal,
    processStderr: stderrLines,
  }

  writeJsonLines(path.join(RUN_OUTPUT_DIR, 'watcher-events.jsonl'), watcherEvents)
  writeJsonLines(path.join(RUN_OUTPUT_DIR, 'interaction-events.jsonl'), interactionEvents)
  fs.writeFileSync(
    path.join(RUN_OUTPUT_DIR, 'summary.json'),
    JSON.stringify(summary, null, 2),
    'utf8',
  )

  try {
    assertE2EResults(summary, interactionEvents)
    console.log(`[AppWatcherWindowsE2E] Saved artifacts in: ${RUN_OUTPUT_DIR}`)
    exitWithCode(0)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[AppWatcherWindowsE2E] FAILED: ${message}`)
    console.error(`[AppWatcherWindowsE2E] Artifacts: ${RUN_OUTPUT_DIR}`)
    exitWithCode(1)
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error(`[AppWatcherWindowsE2E] Fatal error: ${message}`)
  exitWithCode(1)
})
