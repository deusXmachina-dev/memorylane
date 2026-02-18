/**
 * Integration test: video recorder start → split → stop
 *
 * Exercises the real Swift subprocess and TypeScript pipeline end-to-end.
 * Run with: node ./scripts/enode.js ./node_modules/.bin/tsx agent-e2e/video-segment-integration.ts
 *
 * Requires Screen Recording permission granted to the terminal/IDE.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

let recordingsDir: string

async function main(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memorylane-video-test-'))
  recordingsDir = tmpDir
  console.log(`[Test] Using temp recordings dir: ${recordingsDir}`)

  // We can't easily use the video-recorder module directly because it depends on
  // electron's `app` module for paths. Instead, test the Swift binary directly
  // with the same protocol the TS module uses.

  const { spawn } = await import('child_process')
  const { createInterface } = await import('readline')

  // Find the compiled binary
  const binaryPath = path.resolve(process.cwd(), 'build', 'swift', 'screen-recorder')
  if (!fs.existsSync(binaryPath)) {
    console.error(`[Test] FAIL: screen-recorder binary not found at ${binaryPath}`)
    console.error('[Test] Run "npm run build:swift" first')
    process.exit(1)
  }

  console.log(`[Test] Spawning: ${binaryPath} ${recordingsDir}`)
  const child = spawn(
    binaryPath,
    [recordingsDir, '--width', '640', '--height', '360', '--fps', '2'],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )

  const events: Array<Record<string, unknown>> = []
  const rl = createInterface({ input: child.stdout! })

  rl.on('line', (line) => {
    try {
      const event = JSON.parse(line)
      events.push(event)
      console.log(`[Test] Event: ${JSON.stringify(event)}`)
    } catch {
      console.log(`[Test] stdout (unparsed): ${line}`)
    }
  })

  child.stderr?.on('data', (data) => {
    console.log(`[Test] stderr: ${data.toString().trim()}`)
  })

  // Step 1: Wait for recording to start
  console.log('\n[Test] Step 1: Waiting for recording to start...')
  const recordingEvent = await waitForEvent(events, 'recording', 30_000)
  assert(recordingEvent !== null, 'Should receive "recording" status')
  const displays = recordingEvent!.displays as number[]
  assert(displays.length > 0, `Should have at least 1 display, got ${displays.length}`)
  console.log(`[Test] ✓ Recording started on ${displays.length} display(s): ${displays.join(', ')}`)

  // Step 2: Record for 3 seconds to accumulate some frames
  console.log('\n[Test] Step 2: Recording for 3 seconds...')
  await sleep(3000)

  // Step 3: Trigger a split on the first display
  const displayId = displays[0]
  const splitOutputPath = path.join(recordingsDir, `split_test_${displayId}.mp4`)
  const splitCmd = JSON.stringify({ command: 'split', displayId, outputPath: splitOutputPath })
  console.log(`\n[Test] Step 3: Sending split command for display ${displayId}`)
  child.stdin!.write(splitCmd + '\n')

  // Wait for segment_complete
  const segmentEvent = await waitForEvent(events, 'segment_complete', 15_000)
  assert(segmentEvent !== null, 'Should receive "segment_complete" after split')
  assert(segmentEvent!.displayId === displayId, `segment displayId should be ${displayId}`)
  const segmentPath = segmentEvent!.filepath as string
  assert(fs.existsSync(segmentPath), `Segment file should exist: ${segmentPath}`)
  const segmentSize = fs.statSync(segmentPath).size
  assert(segmentSize > 0, `Segment file should not be empty (got ${segmentSize} bytes)`)
  const startTs = segmentEvent!.startTimestamp as number
  const endTs = segmentEvent!.endTimestamp as number
  assert(endTs > startTs, `endTimestamp (${endTs}) should be > startTimestamp (${startTs})`)
  console.log(
    `[Test] ✓ Segment complete: ${path.basename(segmentPath)} (${segmentSize} bytes, ${((endTs - startTs) / 1000).toFixed(1)}s)`,
  )

  // Step 4: Record a bit more, then stop
  console.log('\n[Test] Step 4: Recording 2 more seconds, then stopping...')
  await sleep(2000)

  const stopCmd = JSON.stringify({ command: 'stop' })
  child.stdin!.write(stopCmd + '\n')

  // Wait for final segment_complete (from stop) — must be a different event than the split one
  const finalSegment = await waitForEvent(events, 'segment_complete', 15_000, segmentEvent!)
  assert(finalSegment !== null, 'Should receive final "segment_complete" on stop')
  const finalPath = finalSegment!.filepath as string
  assert(fs.existsSync(finalPath), `Final segment file should exist: ${finalPath}`)
  assert(
    finalPath !== segmentPath,
    'Final segment should be a different file than the split segment',
  )
  console.log(
    `[Test] ✓ Final segment: ${path.basename(finalPath)} (${fs.statSync(finalPath).size} bytes)`,
  )

  const stoppedEvent = await waitForEvent(events, 'stopped', 5_000)
  assert(stoppedEvent !== null, 'Should receive "stopped" status')
  console.log('[Test] ✓ Process reported stopped')

  // Wait for process to exit
  await new Promise<void>((resolve) => {
    child.on('close', (code) => {
      console.log(`[Test] Process exited with code ${code}`)
      resolve()
    })
    // Give it 5s to exit
    setTimeout(() => resolve(), 5000)
  })

  // Step 5: Verify the split created a new segment (the file we specified)
  console.log('\n[Test] Step 5: Verifying segment files on disk...')
  const allFiles = fs.readdirSync(recordingsDir).filter((f) => f.endsWith('.mp4'))
  console.log(`[Test] Files in recordings dir: ${allFiles.join(', ')}`)
  assert(allFiles.length >= 2, `Should have at least 2 segment files, got ${allFiles.length}`)
  console.log(`[Test] ✓ Found ${allFiles.length} segment files`)

  // Cleanup
  for (const file of fs.readdirSync(recordingsDir)) {
    fs.unlinkSync(path.join(recordingsDir, file))
  }
  fs.rmdirSync(recordingsDir)

  console.log('\n[Test] ========================================')
  console.log('[Test] ✓ All checks passed!')
  console.log('[Test] ========================================')
  process.exit(0)
}

// --- Helpers ---

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`[Test] FAIL: ${message}`)
    process.exit(1)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function waitForEvent(
  events: Array<Record<string, unknown>>,
  status: string,
  timeoutMs: number,
  excludeEvent?: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  // Check if already received (excluding a specific event)
  const existing = events.find((e) => e.status === status && e !== excludeEvent)
  if (existing) return Promise.resolve(existing)

  return new Promise((resolve) => {
    const startLen = events.length
    const interval = setInterval(() => {
      for (let i = startLen; i < events.length; i++) {
        if (events[i].status === status && events[i] !== excludeEvent) {
          clearInterval(interval)
          clearTimeout(timeout)
          resolve(events[i])
          return
        }
      }
    }, 100)

    const timeout = setTimeout(() => {
      clearInterval(interval)
      console.error(`[Test] Timed out waiting for "${status}" event after ${timeoutMs}ms`)
      resolve(null)
    }, timeoutMs)
  })
}

main().catch((err) => {
  console.error('[Test] Unhandled error:', err)
  process.exit(1)
})
