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
  external: ['better-sqlite3', 'sqlite-vec', '@huggingface/transformers', 'onnxruntime-node'],
  banner: {
    js: '#!/usr/bin/env node\nprocess.env.NODE_ENV = "production";',
  },
})
