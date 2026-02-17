import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './agent-e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1, // Electron tests must run serially
})
