/**
 * Must be imported BEFORE any module that transitively loads onnxruntime-node.
 *
 * On Windows, onnxruntime_binding.node depends on onnxruntime.dll and
 * DirectML.dll in the same directory, and both statically import the x64 VC++
 * runtime (vcruntime140*.dll / msvcp140*.dll). The Windows DLL loader doesn't
 * always find sibling DLLs inside the deeply nested asar.unpacked path, and
 * clean machines may lack the VC++ redistributable entirely — either failing
 * with "The specified module could not be found" at load time. We ship the VC++
 * runtime in resources/vcruntime (see scripts/copy-vc-runtime-win.js) and add
 * both directories to PATH at module-evaluation time — before any subsequent
 * static import can trigger a require('onnxruntime-node').
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
  const vcRuntimeDir = path.join(process.resourcesPath, 'vcruntime')
  process.env.PATH = `${vcRuntimeDir};${onnxBinDir};${process.env.PATH ?? ''}`
}
