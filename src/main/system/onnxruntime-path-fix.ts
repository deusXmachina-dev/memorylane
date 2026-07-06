/**
 * Must be imported BEFORE any module that transitively loads onnxruntime-node.
 *
 * On Windows, onnxruntime_binding.node depends on onnxruntime.dll, DirectML.dll,
 * and the x64 VC++ runtime (vcruntime140*.dll / msvcp140*.dll). All of these live
 * in the addon's own directory — onnxruntime.dll/DirectML.dll ship there, and the
 * VC++ runtime is copied in at package time (see build/bundle-win-runtime.js) so
 * clean machines without the VC++ redistributable can still load it. We also add
 * that directory to PATH at module-evaluation time — before any subsequent static
 * import can trigger a require('onnxruntime-node').
 */
import path from 'node:path'
import { app } from 'electron'

if (process.platform === 'win32' && app.isPackaged) {
  const onnxBinDir = path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'onnxruntime-node',
    'bin',
    'napi-v3',
    'win32',
    process.arch,
  )
  process.env.PATH = `${onnxBinDir};${process.env.PATH ?? ''}`
}
