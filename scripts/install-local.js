#!/usr/bin/env node

const path = require('node:path')
const { spawnSync } = require('node:child_process')

if (process.platform !== 'darwin') {
  console.error('install:local is only supported on macOS.')
  process.exit(1)
}

const installScriptPath = path.join(__dirname, 'install-local.sh')
const result = spawnSync('bash', [installScriptPath], {
  stdio: 'inherit',
})

if (result.error) {
  console.error(`Failed to run installer: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
