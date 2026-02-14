#!/usr/bin/env node

const { spawn } = require('node:child_process')

const args = process.argv.slice(2)

if (args.length === 0) {
  console.error('Usage: node ./scripts/enode.js <command> [args...]')
  process.exit(1)
}

const electronPath = require('electron')

const child = spawn(electronPath, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
  },
})

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
