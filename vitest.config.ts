import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Globals true means we can use 'describe', 'it', 'expect' without importing them
    globals: true,
    // Native modules like LanceDB need to be handled.
    // Vitest runs in Node.js by default, which is what we want for backend/main process tests.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    // Handle external native dependencies
    server: {
      deps: {
        external: ['@lancedb/lancedb'],
      },
    },
  },
});
