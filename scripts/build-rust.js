#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const repoRoot = path.resolve(__dirname, '..')
const outputDir = path.join(repoRoot, 'build', 'rust')

const targetsByPlatform = {
  win32: {
    label: 'Windows app watcher sidecar',
    manifestPath: path.join(repoRoot, 'native', 'windows', 'app-watcher', 'Cargo.toml'),
    builtBinary: path.join(
      repoRoot,
      'native',
      'windows',
      'app-watcher',
      'target',
      'release',
      'app-watcher-windows.exe',
    ),
    outputBinary: path.join(outputDir, 'app-watcher-windows.exe'),
  },
  darwin: {
    label: 'macOS screenshot capturer sidecar',
    manifestPath: path.join(repoRoot, 'native', 'mac', 'screenshot-capturer', 'Cargo.toml'),
    builtBinary: path.join(
      repoRoot,
      'native',
      'mac',
      'screenshot-capturer',
      'target',
      'release',
      'screenshot-capturer-mac',
    ),
    outputBinary: path.join(outputDir, 'screenshot-capturer-mac'),
  },
}

const target = targetsByPlatform[process.platform]
if (!target) {
  console.log(
    `[build:rust] Skipping Rust sidecar build on unsupported platform: ${process.platform}`,
  )
  process.exit(0)
}

if (!fs.existsSync(target.manifestPath)) {
  console.error(`[build:rust] Missing Cargo manifest: ${target.manifestPath}`)
  process.exit(1)
}

console.log(`[build:rust] Building ${target.label}...`)
const result = spawnSync('cargo', ['build', '--release', '--manifest-path', target.manifestPath], {
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

if (!fs.existsSync(target.builtBinary)) {
  console.error(
    `[build:rust] Cargo build succeeded but binary was not found at ${target.builtBinary}`,
  )
  process.exit(1)
}

fs.mkdirSync(outputDir, { recursive: true })
fs.copyFileSync(target.builtBinary, target.outputBinary)
console.log(`[build:rust] Copied sidecar to ${target.outputBinary}`)
