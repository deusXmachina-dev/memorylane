import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

const buildTimeBackendUrl =
  process.env.MEMORYLANE_BACKEND_URL ?? 'https://enterprise.trymemorylane.com/'

export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@': resolve(__dirname, 'src'),
      '@constants': resolve(__dirname, 'src/shared/constants'),
      '@types': resolve(__dirname, 'src/shared/types'),
    },
  },
  define: {
    __MEMORYLANE_BACKEND_URL__: JSON.stringify(buildTimeBackendUrl),
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    server: {
      deps: {
        external: ['better-sqlite3'],
      },
    },
  },
})
