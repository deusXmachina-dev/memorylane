#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

if (process.platform !== 'win32') {
  console.log('[build:rust] Skipping Rust sidecar build on non-Windows platform.')
  process.exit(0)
}

const repoRoot = path.resolve(__dirname, '..')
const outputDir = path.join(repoRoot, 'build', 'rust')

const sidecars = [
  {
    label: 'Windows app watcher',
    crateDir: path.join(repoRoot, 'native', 'windows', 'app-watcher'),
    binaryName: 'app-watcher-windows.exe',
  },
  {
    label: 'Windows screenshot capturer',
    crateDir: path.join(repoRoot, 'native', 'windows', 'screenshot-capturer'),
    binaryName: 'screenshot-capturer-windows.exe',
  },
]

function buildSidecar(sidecar) {
  const manifestPath = path.join(sidecar.crateDir, 'Cargo.toml')
  if (!fs.existsSync(manifestPath)) {
    console.error(`[build:rust] Missing Cargo manifest: ${manifestPath}`)
    process.exit(1)
  }

  console.log(`[build:rust] Building ${sidecar.label} sidecar...`)
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

  const builtBinary = path.join(sidecar.crateDir, 'target', 'release', sidecar.binaryName)
  if (!fs.existsSync(builtBinary)) {
    console.error(`[build:rust] Cargo build succeeded but binary was not found at ${builtBinary}`)
    process.exit(1)
  }

  fs.mkdirSync(outputDir, { recursive: true })
  const outputBinary = path.join(outputDir, sidecar.binaryName)
  fs.copyFileSync(builtBinary, outputBinary)
  console.log(`[build:rust] Copied sidecar to ${outputBinary}`)
}

for (const sidecar of sidecars) {
  buildSidecar(sidecar)
}
