/**
 * Must be imported BEFORE any module that transitively loads onnxruntime-node.
 *
 * On Windows, onnxruntime_binding.node depends on onnxruntime.dll and
 * DirectML.dll in the same directory. The Windows DLL loader doesn't always
 * find sibling DLLs inside the deeply nested asar.unpacked path, so we add
 * the directory to PATH at module-evaluation time — before any subsequent
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
  process.env.PATH = `${onnxBinDir};${process.env.PATH ?? ''}`
}
