/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs')
const path = require('path')

// Copies the staged x64 VC++ runtime DLLs (produced by
// scripts/copy-vc-runtime-win.js in build/win-runtime) into the packaged
// onnxruntime-node native dir, directly next to onnxruntime_binding.node.
//
// They must sit *beside* the addon. Native modules load via
// LOAD_WITH_ALTERED_SEARCH_PATH, which resolves a module's dependencies from the
// module's own directory (and System32) but does not reliably consult PATH — so
// shipping the runtime to a separate resources dir and adding it to PATH does not
// work. Co-locating is the same guarantee that lets the sibling onnxruntime.dll
// resolve, and mirrors what installing the VC++ redistributable (into System32)
// achieves.
exports.default = async function bundleWinRuntime(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'win32') return

  const stagedDir = path.join(__dirname, '..', 'build', 'win-runtime')
  const dlls = fs.existsSync(stagedDir)
    ? fs.readdirSync(stagedDir).filter((f) => f.toLowerCase().endsWith('.dll'))
    : []
  if (dlls.length === 0) {
    throw new Error(
      '[vc-runtime] build/win-runtime has no DLLs; run scripts/copy-vc-runtime-win.js before packaging.',
    )
  }

  const binRoot = path.join(
    appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'onnxruntime-node',
    'bin',
  )
  const targets = []
  for (const napi of fs.existsSync(binRoot) ? fs.readdirSync(binRoot) : []) {
    const dir = path.join(binRoot, napi, 'win32', 'x64')
    if (fs.existsSync(path.join(dir, 'onnxruntime_binding.node'))) targets.push(dir)
  }
  if (targets.length === 0) {
    throw new Error('[vc-runtime] onnxruntime-node win32/x64 dir not found in packaged app.')
  }

  for (const dir of targets) {
    for (const dll of dlls) {
      fs.copyFileSync(path.join(stagedDir, dll), path.join(dir, dll))
      console.log(`[vc-runtime] afterPack: ${dll} -> ${dir}`)
    }
  }
}
