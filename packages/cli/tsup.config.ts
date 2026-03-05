import { defineConfig } from 'tsup'
import * as path from 'path'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node18',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  esbuildOptions(options) {
    options.alias = {
      '@main': path.resolve(__dirname, '../../src/main'),
    }
  },
  external: [
    'better-sqlite3',
    'sqlite-vec',
    '@huggingface/transformers',
    'onnxruntime-node',
    'electron',
    'electron-log',
    'electron-log/main',
  ],
  banner: {
    js: [
      '#!/usr/bin/env node',
      'process.env.NODE_ENV = "production";',
      // Stub electron-log with a silent no-op logger so nothing is printed.
      'var _noop = () => {}; console.log = _noop; var _noopLog = { debug: _noop, info: _noop, warn: _noop, error: _noop, transports: { file: {}, console: {} } };',
      'var _origRequire = require; require = Object.assign((id) => { if (id === "electron-log/main") return _noopLog; return _origRequire(id); }, _origRequire);',
    ].join('\n'),
  },
})
