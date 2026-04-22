import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@constants': resolve(__dirname, 'src/shared/constants'),
      },
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'mcp-entry': resolve(__dirname, 'src/main/mcp-entry.ts'),
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
