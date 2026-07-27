#!/usr/bin/env node

const { spawn } = require('node:child_process')
const path = require('node:path')

const args = process.argv.slice(2)

if (args.length === 0) {
  console.error('Usage: node ./scripts/enode.js <command> [args...]')
  process.exit(1)
}

const electronPath = require('electron')

// Via NODE_OPTIONS rather than a --require flag so it also reaches the process
// tsx spawns for the script itself.
const exitOnSignal = `--require ${path.join(__dirname, 'exit-on-signal.cjs')}`

const child = spawn(electronPath, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_OPTIONS: process.env.NODE_OPTIONS
      ? `${process.env.NODE_OPTIONS} ${exitOnSignal}`
      : exitOnSignal,
  },
})

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill('SIGKILL'))
}

child.on('error', (error) => {
  console.error(`[enode] Failed to start Electron runtime: ${error.message}`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})
