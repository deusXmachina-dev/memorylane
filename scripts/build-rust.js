#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

if (process.platform !== 'win32') {
  console.log('[build:rust] Skipping Rust watcher build on non-Windows platform.')
  process.exit(0)
}

const repoRoot = path.resolve(__dirname, '..')
const manifestPath = path.join(repoRoot, 'native', 'windows', 'app-watcher', 'Cargo.toml')
const outputDir = path.join(repoRoot, 'build', 'rust')
const outputBinary = path.join(outputDir, 'app-watcher-windows.exe')
const builtBinary = path.join(
  repoRoot,
  'native',
  'windows',
  'app-watcher',
  'target',
  'release',
  'app-watcher-windows.exe',
)

if (!fs.existsSync(manifestPath)) {
  console.error(`[build:rust] Missing Cargo manifest: ${manifestPath}`)
  process.exit(1)
}

console.log('[build:rust] Building Windows app watcher sidecar...')
const result = spawnSync('cargo', ['build', '--release', '--manifest-path', manifestPath], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: false,
})

if (result.error) {
  console.error(`[build:rust] Failed to launch cargo: ${result.error.message}`)
  process.exit(1)
}

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

if (!fs.existsSync(builtBinary)) {
  console.error(`[build:rust] Cargo build succeeded but binary was not found at ${builtBinary}`)
  process.exit(1)
}

fs.mkdirSync(outputDir, { recursive: true })
fs.copyFileSync(builtBinary, outputBinary)
console.log(`[build:rust] Copied sidecar to ${outputBinary}`)
