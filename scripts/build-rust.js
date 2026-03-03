#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

if (process.platform !== 'win32') {
  console.log('[build:rust] Skipping Rust watcher build on non-Windows platform.')
  process.exit(0)
}

const repoRoot = path.resolve(__dirname, '..')
const outputDir = path.join(repoRoot, 'build', 'rust')
fs.mkdirSync(outputDir, { recursive: true })

const sidecars = [
  {
    name: 'Windows app watcher sidecar',
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
  {
    name: 'Windows screenshot sidecar',
    manifestPath: path.join(repoRoot, 'native', 'windows', 'screenshot-capturer', 'Cargo.toml'),
    builtBinary: path.join(
      repoRoot,
      'native',
      'windows',
      'screenshot-capturer',
      'target',
      'release',
      'screenshot-capturer-windows.exe',
    ),
    outputBinary: path.join(outputDir, 'screenshot-capturer-windows.exe'),
  },
]

function copySidecarOrReuseExisting(sourcePath, destinationPath) {
  try {
    fs.copyFileSync(sourcePath, destinationPath)
    console.log(`[build:rust] Copied sidecar to ${destinationPath}`)
    return
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'EBUSY' || error.code === 'EPERM') &&
      fs.existsSync(destinationPath)
    ) {
      console.warn(
        `[build:rust] Could not replace locked sidecar at ${destinationPath}; reusing existing file.`,
      )
      return
    }

    throw error
  }
}

for (const sidecar of sidecars) {
  if (!fs.existsSync(sidecar.manifestPath)) {
    console.error(`[build:rust] Missing Cargo manifest: ${sidecar.manifestPath}`)
    process.exit(1)
  }

  console.log(`[build:rust] Building ${sidecar.name}...`)
  const result = spawnSync(
    'cargo',
    ['build', '--release', '--manifest-path', sidecar.manifestPath],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
    },
  )

  if (result.error) {
    console.error(`[build:rust] Failed to launch cargo: ${result.error.message}`)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }

  if (!fs.existsSync(sidecar.builtBinary)) {
    console.error(
      `[build:rust] Cargo build succeeded but binary was not found at ${sidecar.builtBinary}`,
    )
    process.exit(1)
  }

  copySidecarOrReuseExisting(sidecar.builtBinary, sidecar.outputBinary)
}
