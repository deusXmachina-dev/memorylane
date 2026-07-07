import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const buildTimeBackendUrl =
  process.env.MEMORYLANE_BACKEND_URL ??
  (process.env.NODE_ENV === 'development'
    ? 'http://localhost:8000/'
    : 'https://enterprise.trymemorylane.com/')

export default defineConfig({
  main: {
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
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'mcp-entry': resolve(__dirname, 'src/main/mcp-entry.ts'),
          'upload-prep-worker': resolve(__dirname, 'src/main/services/upload-prep-worker.ts'),
        },
        external: [
          'uiohook-napi',
          'better-sqlite3',
          'sqlite-vec',
          'onnxruntime-node',
          'onnxruntime-common',
          'sharp',
        ],
      },
    },
  },
  preload: {
    define: {
      __MEMORYLANE_BACKEND_URL__: JSON.stringify(buildTimeBackendUrl),
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: true,
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@components': resolve(__dirname, 'src/renderer/components'),
        '@constants': resolve(__dirname, 'src/shared/constants'),
        '@types': resolve(__dirname, 'src/shared/types'),
        '@assets': resolve(__dirname, 'assets'),
      },
    },
    define: {
      __MEMORYLANE_BACKEND_URL__: JSON.stringify(buildTimeBackendUrl),
    },
    plugins: [tailwindcss(), react()],
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          'main-window': resolve(__dirname, 'src/renderer/main-window.html'),
        },
      },
    },
  },
})
