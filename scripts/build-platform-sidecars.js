#!/usr/bin/env node

const { spawnSync } = require('node:child_process')

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function runNpmScript(scriptName) {
  const result = spawnSync(npmCommand, ['run', scriptName], {
    stdio: 'inherit',
    shell: false,
  })

  if (result.error) {
    console.error(
      `[build:sidecars:platform] Failed to run "${scriptName}": ${result.error.message}`,
    )
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

if (process.platform === 'darwin') {
  runNpmScript('build:swift')
  process.exit(0)
}

if (process.platform === 'win32') {
  runNpmScript('build:rust')
  process.exit(0)
}

console.log(`[build:sidecars:platform] No platform sidecar build required for ${process.platform}.`)
