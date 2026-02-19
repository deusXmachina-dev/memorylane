/**
 * Screenshot benchmark: captures every 100ms for 10 seconds using the native Swift module.
 * Measures per-capture latency, total CPU time, and peak memory of the Swift process.
 *
 * Usage: node ./scripts/enode.js ./node_modules/.bin/tsx scripts/benchmark-screenshot.ts [options]
 *   --format png|jpg    Image format (default: png)
 *   --interval <ms>     Capture interval in ms (default: 100)
 *   --duration <ms>     Total duration in ms (default: 10000)
 */

import { spawn, execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as readline from 'readline'

// Parse CLI args
const cliArgs = process.argv.slice(2)

function cliOption(name: string, fallback: string): string {
  const idx = cliArgs.indexOf(`--${name}`)
  return idx !== -1 && idx + 1 < cliArgs.length ? cliArgs[idx + 1] : fallback
}

const INTERVAL_MS = parseInt(cliOption('interval', '100'), 10)
const DURATION_MS = parseInt(cliOption('duration', '10000'), 10)
const TOTAL_CAPTURES = Math.floor(DURATION_MS / INTERVAL_MS)
const format = cliOption('format', 'png')

// Resolve the compiled Swift binary
const binaryPath = path.resolve(process.cwd(), 'build', 'swift', 'screenshot')
if (!fs.existsSync(binaryPath)) {
  console.error(`Binary not found at ${binaryPath}. Run: npm run build:swift`)
  process.exit(1)
}

interface CaptureResult {
  width: number
  height: number
  elapsed_ms: number
  path: string
}

function sampleProcessStats(pid: number): { rss_kb: number; cpu_pct: number } | null {
  try {
    const out = execSync(`ps -o rss=,%cpu= -p ${pid}`, { encoding: 'utf8' }).trim()
    const [rss, cpu] = out.split(/\s+/)
    return { rss_kb: parseInt(rss, 10), cpu_pct: parseFloat(cpu) }
  } catch {
    return null
  }
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

async function main(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenshot-bench-'))
  console.log(`\nBenchmark config:`)
  console.log(`  interval: ${INTERVAL_MS}ms`)
  console.log(`  duration: ${DURATION_MS}ms`)
  console.log(`  captures: ${TOTAL_CAPTURES}`)
  console.log(`  format:   ${format}`)
  console.log(`  tmp dir:  ${tmpDir}\n`)

  // Spawn streaming screenshot process
  const proc = spawn(binaryPath, ['--stream', '--format', format])
  const pid = proc.pid!
  console.log(`Swift process started (pid=${pid})\n`)

  const rl = readline.createInterface({ input: proc.stdout })

  const latencies: number[] = []
  const fileSizes: number[] = []
  const memSamples: number[] = []
  const cpuSamples: number[] = []
  let capturesSent = 0

  // Sample Swift process memory every 500ms
  const statsSampler = setInterval(() => {
    const stats = sampleProcessStats(pid)
    if (stats) {
      memSamples.push(stats.rss_kb)
      cpuSamples.push(stats.cpu_pct)
    }
  }, 500)

  // Collect results as they come in
  const resultPromise = new Promise<void>((resolve) => {
    rl.on('line', (line) => {
      try {
        const result: CaptureResult = JSON.parse(line)
        latencies.push(result.elapsed_ms)
        try {
          const stat = fs.statSync(result.path)
          fileSizes.push(stat.size)
        } catch {
          // file may have been cleaned up
        }
      } catch {
        console.error(`  Failed to parse: ${line}`)
      }
    })
    rl.on('close', resolve)
  })

  // Record overall timing
  const wallStart = Date.now()
  const cpuStart = process.cpuUsage()

  // Send capture requests at fixed intervals
  await new Promise<void>((resolve) => {
    const iv = setInterval(() => {
      const outputPath = path.join(tmpDir, `${capturesSent}.${format === 'jpg' ? 'jpg' : 'png'}`)
      proc.stdin.write(outputPath + '\n')
      capturesSent++

      if (capturesSent >= TOTAL_CAPTURES) {
        clearInterval(iv)
        proc.stdin.end()
        resolve()
      }
    }, INTERVAL_MS)
  })

  // Wait for all results
  await resultPromise
  clearInterval(statsSampler)

  const wallElapsed = Date.now() - wallStart
  const cpuElapsed = process.cpuUsage(cpuStart)

  // Final memory sample
  const finalStats = sampleProcessStats(pid)
  if (finalStats) {
    memSamples.push(finalStats.rss_kb)
  }

  // -- Report --
  const sorted = [...latencies].sort((a, b) => a - b)
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length
  const avgFileSize =
    fileSizes.length > 0 ? fileSizes.reduce((a, b) => a + b, 0) / fileSizes.length : 0
  const peakMemKb = memSamples.length > 0 ? Math.max(...memSamples) : 0
  const avgMemKb =
    memSamples.length > 0 ? memSamples.reduce((a, b) => a + b, 0) / memSamples.length : 0
  const avgCpu =
    cpuSamples.length > 0 ? cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length : 0

  console.log(`\n${'='.repeat(50)}`)
  console.log(`  Screenshot Benchmark Results`)
  console.log(`${'='.repeat(50)}`)
  console.log(``)
  console.log(`  Captures:     ${latencies.length} / ${TOTAL_CAPTURES} sent`)
  console.log(`  Wall time:    ${wallElapsed}ms`)
  console.log(`  Effective Hz: ${((latencies.length / wallElapsed) * 1000).toFixed(1)} fps`)
  console.log(``)
  console.log(`  -- Capture Latency (Swift-side) --`)
  console.log(`  Mean:         ${avgLatency.toFixed(2)}ms`)
  console.log(`  Median:       ${percentile(sorted, 50).toFixed(2)}ms`)
  console.log(`  P95:          ${percentile(sorted, 95).toFixed(2)}ms`)
  console.log(`  P99:          ${percentile(sorted, 99).toFixed(2)}ms`)
  console.log(`  Min:          ${sorted[0]?.toFixed(2) ?? '-'}ms`)
  console.log(`  Max:          ${sorted[sorted.length - 1]?.toFixed(2) ?? '-'}ms`)
  console.log(``)
  console.log(`  -- File Size --`)
  console.log(`  Avg file:     ${(avgFileSize / 1024).toFixed(0)} KB`)
  console.log(
    `  Total disk:   ${(fileSizes.reduce((a, b) => a + b, 0) / 1024 / 1024).toFixed(1)} MB`,
  )
  console.log(``)
  console.log(`  -- Swift Process Resources --`)
  console.log(`  Peak RSS:     ${(peakMemKb / 1024).toFixed(1)} MB`)
  console.log(`  Avg RSS:      ${(avgMemKb / 1024).toFixed(1)} MB`)
  console.log(`  Avg CPU%:     ${avgCpu.toFixed(1)}%`)
  console.log(``)
  console.log(`  -- Node.js Orchestrator --`)
  console.log(`  CPU user:     ${(cpuElapsed.user / 1000).toFixed(0)}ms`)
  console.log(`  CPU system:   ${(cpuElapsed.system / 1000).toFixed(0)}ms`)
  console.log(`  RSS:          ${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)} MB`)
  console.log(`${'='.repeat(50)}\n`)

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true })
  console.log(`Cleaned up ${tmpDir}`)
}

main().catch((err) => {
  console.error('Benchmark failed:', err)
  process.exit(1)
})
