#!/usr/bin/env node
// Stages the x64 Visual C++ runtime DLLs for packaging. onnxruntime_binding.node
// and onnxruntime.dll statically import vcruntime140*.dll / msvcp140*.dll; on a
// clean Windows machine without the VC++ redistributable the loader fails with
// "The specified module could not be found" (error 126) at startup.
//
// The DLLs are copied into build/win-runtime/, shipped to resources/vcruntime
// via electron-builder (win.extraResources), and that dir is prepended to PATH
// at runtime in src/main/system/onnxruntime-path-fix.ts so they resolve when the
// native module is dlopen'd under LOAD_WITH_ALTERED_SEARCH_PATH.
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

// This script only runs from make:win, so a non-Windows host here means a
// Windows target is being cross-built — where the VC++ runtime DLLs can't be
// sourced. Fail loudly rather than silently shipping a build that crashes on
// clean machines. Build Windows artifacts on a Windows host.
if (process.platform !== 'win32') {
  console.error(
    '[vc-runtime] Cannot stage the x64 VC++ runtime on a non-Windows host. ' +
      'Build Windows artifacts (make:win) on a Windows machine so onnxruntime loads on clean installs.',
  )
  process.exit(1)
}

const repoRoot = path.resolve(__dirname, '..')
const outputDir = path.join(repoRoot, 'build', 'win-runtime')

const REQUIRED_DLLS = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll', 'msvcp140_1.dll']

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

// Source dirs for the runtime DLLs, best first: the VS redist (canonical for
// redistribution), then System32 as a fallback on machines that have the
// runtime installed but not the full VS redist tree.
function sourceDirs() {
  const dirs = []
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const vswhere = path.join(pf86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  if (fs.existsSync(vswhere)) {
    const res = spawnSync(vswhere, ['-latest', '-products', '*', '-property', 'installationPath'], {
      encoding: 'utf8',
    })
    const install = (res.stdout || '').trim().split(/\r?\n/)[0]
    if (install) {
      const redistRoot = path.join(install, 'VC', 'Redist', 'MSVC')
      for (const ver of safeReaddir(redistRoot).sort().reverse()) {
        const x64 = path.join(redistRoot, ver, 'x64')
        for (const crt of safeReaddir(x64)) {
          if (/^Microsoft\.VC\d+\.CRT$/i.test(crt)) dirs.push(path.join(x64, crt))
        }
      }
    }
  }
  if (process.env.VCToolsRedistDir) {
    const x64 = path.join(process.env.VCToolsRedistDir, 'x64')
    for (const crt of safeReaddir(x64)) {
      if (/^Microsoft\.VC\d+\.CRT$/i.test(crt)) dirs.push(path.join(x64, crt))
    }
  }
  dirs.push(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'))
  return dirs
}

function findDll(name, dirs) {
  for (const dir of dirs) {
    const candidate = path.join(dir, name)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

const sources = sourceDirs()
fs.mkdirSync(outputDir, { recursive: true })

for (const dll of REQUIRED_DLLS) {
  const found = findDll(dll, sources)
  if (!found) {
    console.error(
      `[vc-runtime] Required runtime DLL not found: ${dll}\n` +
        `Searched:\n${sources.map((d) => `  - ${d}`).join('\n')}\n` +
        'Install the Microsoft Visual C++ Redistributable (x64) on the build machine and retry.',
    )
    process.exit(1)
  }
  const dest = path.join(outputDir, dll)
  fs.copyFileSync(found, dest)
  console.log(`[vc-runtime] ${dll} -> ${dest}`)
}

console.log(`[vc-runtime] Staged ${REQUIRED_DLLS.length} VC++ runtime DLL(s) for packaging.`)
