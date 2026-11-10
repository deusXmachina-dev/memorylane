import { defineConfig } from 'tsup'
import * as path from 'path'

export default defineConfig({
  entry: ['src/index.ts', 'src/mcp.ts'],
  format: ['cjs'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  esbuildOptions(options) {
    options.alias = {
      '@main': path.resolve(__dirname, '../../src/main'),
      '@': path.resolve(__dirname, '../../src'),
      '@constants': path.resolve(__dirname, '../../src/shared/constants'),
      '@types': path.resolve(__dirname, '../../src/shared/types'),
    }
  },
  external: ['better-sqlite3', 'sqlite-vec', '@huggingface/transformers'],
  banner: {
    js: '#!/usr/bin/env node\nprocess.env.NODE_ENV = "production";',
  },
})
