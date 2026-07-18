import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve(__dirname, '../../src/main'),
      '@types': resolve(__dirname, '../../src/shared/types'),
      '@': resolve(__dirname, '../../src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    server: {
      deps: {
        external: ['better-sqlite3'],
      },
    },
  },
})
