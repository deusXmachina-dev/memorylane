import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import * as fs from 'fs'
import * as path from 'path'

const MAIN_ENTRY = path.join(__dirname, '..', 'out', 'main', 'index.js')
const TEST_CAPTURES_DIR = path.join(__dirname, '..', 'test-captures')

test('records a short video and saves a valid file', async () => {
  const electronApp = await electron.launch({
    args: [MAIN_ENTRY],
    env: { ...process.env, NODE_ENV: 'development' },
  })

  // Wait for the app to finish initializing
  // (the ready event fires before our globalThis setup completes,
  //  so give it a moment to settle)
  await new Promise((r) => setTimeout(r, 3000))

  // Start recording via the exposed globalThis bridge
  await electronApp.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vr = (globalThis as Record<string, unknown>).__videoRecorder as Record<string, any>
    if (!vr) throw new Error('__videoRecorder not exposed on globalThis')
    await vr.startRecording()
  })

  // Record for 3 seconds
  await new Promise((r) => setTimeout(r, 3000))

  // Stop recording and retrieve result
  const result = await electronApp.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vr = (globalThis as Record<string, unknown>).__videoRecorder as Record<string, any>
    return await vr.stopRecording()
  })

  expect(result).toBeTruthy()
  expect(result.filepath).toBeTruthy()
  expect(result.id).toBeTruthy()
  expect(result.endTimestamp).toBeGreaterThan(result.startTimestamp)

  // Verify the file exists and has content
  expect(fs.existsSync(result.filepath)).toBe(true)
  const stat = fs.statSync(result.filepath)
  expect(stat.size).toBeGreaterThan(0)

  // Copy to test-captures/ for manual inspection, then clean up the original
  fs.mkdirSync(TEST_CAPTURES_DIR, { recursive: true })
  const destPath = path.join(TEST_CAPTURES_DIR, path.basename(result.filepath))
  fs.copyFileSync(result.filepath, destPath)
  console.log(`Recording saved to ${destPath} (${stat.size} bytes)`)
  fs.unlinkSync(result.filepath)

  await electronApp.close()
})
