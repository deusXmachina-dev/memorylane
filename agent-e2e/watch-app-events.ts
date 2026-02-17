#!/usr/bin/env npx tsx
/**
 * Dev helper to inspect active app/window events from the native watcher.
 *
 * Usage:
 *   node ./scripts/enode.js ./node_modules/.bin/tsx agent-e2e/watch-app-events.ts
 *   node ./scripts/enode.js ./node_modules/.bin/tsx agent-e2e/watch-app-events.ts --seconds 30
 *   node ./scripts/enode.js ./node_modules/.bin/tsx agent-e2e/watch-app-events.ts --json
 *   node ./scripts/enode.js ./node_modules/.bin/tsx agent-e2e/watch-app-events.ts --require-window-id
 */

import { startAppWatcher, stopAppWatcher, AppWatcherEvent } from '../src/main/recorder/app-watcher'

interface CLIArgs {
  seconds: number
  json: boolean
  requireWindowId: boolean
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2)
  let seconds = 15
  let json = false
  let requireWindowId = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--seconds' && args[i + 1]) {
      const parsed = Number(args[i + 1])
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --seconds value: ${args[i + 1]}`)
      }
      seconds = parsed
      i++
      continue
    }
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg === '--require-window-id') {
      requireWindowId = true
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return { seconds, json, requireWindowId }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString()
}

function formatEventLine(event: AppWatcherEvent): string {
  const app = event.app ?? '-'
  const title = event.title ?? ''
  const pid = event.pid ?? '-'
  const windowId = event.windowId ?? '-'
  return `[${formatTime(event.timestamp)}] ${event.type} app="${app}" pid=${pid} windowId=${windowId} title="${title}"`
}

async function main(): Promise<void> {
  const { seconds, json, requireWindowId } = parseArgs()

  if (process.platform !== 'darwin') {
    console.error('app-watcher dev script currently supports macOS only.')
    process.exit(1)
  }

  console.log(`Watching app/window events for ${seconds}s...`)
  console.log('Tip: switch between windows/tabs to validate windowId stability.\n')

  let total = 0
  let actionable = 0
  let missingWindowId = 0
  let lastKey = ''

  const stopAndExit = (exitCode: number): void => {
    stopAppWatcher()
    setTimeout(() => process.exit(exitCode), 150)
  }

  const timeout = setTimeout(() => {
    console.log('\n--- Summary ---')
    console.log(`Total events: ${total}`)
    console.log(`Actionable events: ${actionable}`)
    console.log(`Events missing windowId: ${missingWindowId}`)
    if (requireWindowId && actionable > 0 && missingWindowId > 0) {
      console.error('FAIL: Some app/window events were missing windowId.')
      stopAndExit(2)
      return
    }
    stopAndExit(0)
  }, seconds * 1000)

  const handleSignal = (): void => {
    clearTimeout(timeout)
    console.log('\nInterrupted.')
    stopAndExit(130)
  }
  process.once('SIGINT', handleSignal)
  process.once('SIGTERM', handleSignal)

  startAppWatcher((event) => {
    total++
    if (json) {
      console.log(JSON.stringify(event))
    } else {
      console.log(formatEventLine(event))
    }

    if (event.type !== 'app_change' && event.type !== 'window_change') {
      return
    }

    actionable++
    if (event.windowId === undefined) {
      missingWindowId++
    }

    const key = `${event.type}|${event.pid ?? ''}|${event.windowId ?? ''}|${event.title ?? ''}`
    if (key === lastKey) {
      console.log('  ↳ duplicate event key (same type/pid/windowId/title)')
    }
    lastKey = key
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
