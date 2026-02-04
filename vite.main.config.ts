import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['uiohook-napi', '@lancedb/lancedb', 'onnxruntime-node', 'onnxruntime-common', 'sharp'],
    },
  },
});
