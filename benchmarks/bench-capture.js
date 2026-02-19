#!/usr/bin/env electron
// Benchmark for desktopCapturer performance.
// Must run as Electron main process (not ELECTRON_RUN_AS_NODE).
//
// Usage:
//   npx electron scripts/bench-capture.js [options]
//
// Options:
//   -n, --count <N>     Number of captures (default: 100)
//   --width <W>         Thumbnail width  (default: 1920)
//   --height <H>        Thumbnail height (default: 1080)
//   --skip-encode       Skip toPNG() encoding (measure capture only)
//   --save              Also write PNGs to a temp dir (measures I/O)
//   --concurrent <N>    Fire N captures concurrently per batch (default: 1, sequential)
//   --duration <S>      Spread captures evenly over S seconds (e.g. --duration 10)

const { app, desktopCapturer } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

// ── CLI args ──────────────────────────────────────────────────────────
const argv = process.argv.slice(2)

function flag(name) {
  return argv.includes(name)
}

function opt(name, fallback) {
  const idx = argv.indexOf(name)
  if (idx === -1 || idx + 1 >= argv.length) return fallback
  return argv[idx + 1]
}

const COUNT = parseInt(opt('-n', opt('--count', '100')), 10)
const WIDTH = parseInt(opt('--width', '1920'), 10)
const HEIGHT = parseInt(opt('--height', '1080'), 10)
const SKIP_ENCODE = flag('--skip-encode')
const SAVE = flag('--save')
const CONCURRENT = parseInt(opt('--concurrent', '1'), 10)
const DURATION = opt('--duration', null) ? parseFloat(opt('--duration', '0')) : null

// ── Helpers ───────────────────────────────────────────────────────────
function fmt(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fmtMs(ns) {
  return `${(Number(ns) / 1e6).toFixed(2)} ms`
}

function fmtCpu(us) {
  return `${(us / 1000).toFixed(1)} ms`
}

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

// ── Benchmark ─────────────────────────────────────────────────────────
async function run() {
  // Hide dock icon on macOS
  if (process.platform === 'darwin') app.dock?.hide()

  const thumbnailSize = { width: WIDTH, height: HEIGHT }
  const tmpDir = SAVE ? fs.mkdtempSync(path.join(os.tmpdir(), 'bench-capture-')) : null

  console.log('╔══════════════════════════════════════════════════╗')
  console.log('║         desktopCapturer Benchmark                ║')
  console.log('╚══════════════════════════════════════════════════╝')
  console.log()
  console.log(`  Captures:     ${COUNT}`)
  console.log(`  Resolution:   ${WIDTH}×${HEIGHT}`)
  console.log(`  Encode PNG:   ${SKIP_ENCODE ? 'no' : 'yes'}`)
  console.log(`  Save to disk: ${SAVE ? tmpDir : 'no'}`)
  console.log(`  Concurrency:  ${CONCURRENT}`)
  console.log(
    `  Duration:     ${DURATION ? `${DURATION}s (interval: ${((DURATION * 1000) / COUNT).toFixed(0)}ms)` : 'as fast as possible'}`,
  )
  console.log()

  // Warm-up capture (first call has extra overhead)
  await desktopCapturer.getSources({ types: ['screen'], thumbnailSize })

  const captureTimes = [] // per-capture wall time (ns)
  const encodeTimes = [] // per-encode wall time (ns)
  const saveTimes = [] // per-save wall time (ns)

  const memBefore = process.memoryUsage()
  const cpuBefore = process.cpuUsage()
  const wallStart = process.hrtime.bigint()

  let completed = 0

  async function singleCapture(i) {
    // ── Capture ──
    const t0 = process.hrtime.bigint()
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize })
    const t1 = process.hrtime.bigint()
    captureTimes.push(Number(t1 - t0))

    const source = sources[0]
    if (!source) throw new Error('No screen sources available')

    // ── Encode ──
    if (!SKIP_ENCODE) {
      const t2 = process.hrtime.bigint()
      const buf = source.thumbnail.toPNG()
      const t3 = process.hrtime.bigint()
      encodeTimes.push(Number(t3 - t2))

      // ── Save ──
      if (SAVE) {
        const t4 = process.hrtime.bigint()
        fs.writeFileSync(path.join(tmpDir, `${i}.png`), buf)
        const t5 = process.hrtime.bigint()
        saveTimes.push(Number(t5 - t4))
      }
    }

    completed++
    if (completed % 10 === 0 || completed === COUNT) {
      process.stdout.write(`\r  Progress: ${completed}/${COUNT}`)
    }
  }

  // Run captures
  if (DURATION) {
    // Spread captures evenly over the duration
    const intervalMs = (DURATION * 1000) / COUNT
    await new Promise((resolve) => {
      let i = 0
      const tick = () => {
        singleCapture(i).then(() => {
          i++
          if (i >= COUNT) return resolve()
          const elapsed = Number(process.hrtime.bigint() - wallStart) / 1e6
          const nextAt = i * intervalMs
          const delay = Math.max(0, nextAt - elapsed)
          setTimeout(tick, delay)
        })
      }
      tick()
    })
  } else if (CONCURRENT <= 1) {
    for (let i = 0; i < COUNT; i++) {
      await singleCapture(i)
    }
  } else {
    for (let i = 0; i < COUNT; i += CONCURRENT) {
      const batch = []
      for (let j = i; j < Math.min(i + CONCURRENT, COUNT); j++) {
        batch.push(singleCapture(j))
      }
      await Promise.all(batch)
    }
  }

  const wallEnd = process.hrtime.bigint()
  const cpuAfter = process.cpuUsage(cpuBefore)
  const memAfter = process.memoryUsage()

  console.log('\n')

  // ── Results ─────────────────────────────────────────────────────────
  const wallTotal = Number(wallEnd - wallStart)

  captureTimes.sort((a, b) => a - b)
  encodeTimes.sort((a, b) => a - b)
  saveTimes.sort((a, b) => a - b)

  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length

  console.log('── Timing ──────────────────────────────────────────')
  console.log(`  Total wall time:       ${fmtMs(wallTotal)}`)
  console.log(`  Captures/sec:          ${(COUNT / (wallTotal / 1e9)).toFixed(1)}`)
  console.log()
  console.log('  desktopCapturer.getSources():')
  console.log(`    avg:   ${fmtMs(avg(captureTimes))}`)
  console.log(`    p50:   ${fmtMs(percentile(captureTimes, 50))}`)
  console.log(`    p95:   ${fmtMs(percentile(captureTimes, 95))}`)
  console.log(`    p99:   ${fmtMs(percentile(captureTimes, 99))}`)
  console.log(`    min:   ${fmtMs(captureTimes[0])}`)
  console.log(`    max:   ${fmtMs(captureTimes[captureTimes.length - 1])}`)

  if (encodeTimes.length > 0) {
    console.log()
    console.log('  toPNG() encode:')
    console.log(`    avg:   ${fmtMs(avg(encodeTimes))}`)
    console.log(`    p50:   ${fmtMs(percentile(encodeTimes, 50))}`)
    console.log(`    p95:   ${fmtMs(percentile(encodeTimes, 95))}`)
    console.log(`    min:   ${fmtMs(encodeTimes[0])}`)
    console.log(`    max:   ${fmtMs(encodeTimes[encodeTimes.length - 1])}`)
  }

  if (saveTimes.length > 0) {
    console.log()
    console.log('  writeFileSync():')
    console.log(`    avg:   ${fmtMs(avg(saveTimes))}`)
    console.log(`    p50:   ${fmtMs(percentile(saveTimes, 50))}`)
    console.log(`    p95:   ${fmtMs(percentile(saveTimes, 95))}`)
  }

  console.log()
  console.log('── CPU ─────────────────────────────────────────────')
  console.log(`  User:   ${fmtCpu(cpuAfter.user)}`)
  console.log(`  System: ${fmtCpu(cpuAfter.system)}`)
  console.log(`  Total:  ${fmtCpu(cpuAfter.user + cpuAfter.system)}`)

  console.log()
  console.log('── Memory ──────────────────────────────────────────')
  console.log(
    `  RSS:         ${fmt(memBefore.rss)} → ${fmt(memAfter.rss)}  (Δ ${fmt(memAfter.rss - memBefore.rss)})`,
  )
  console.log(
    `  Heap total:  ${fmt(memBefore.heapTotal)} → ${fmt(memAfter.heapTotal)}  (Δ ${fmt(memAfter.heapTotal - memBefore.heapTotal)})`,
  )
  console.log(
    `  Heap used:   ${fmt(memBefore.heapUsed)} → ${fmt(memAfter.heapUsed)}  (Δ ${fmt(memAfter.heapUsed - memBefore.heapUsed)})`,
  )
  console.log(
    `  External:    ${fmt(memBefore.external)} → ${fmt(memAfter.external)}  (Δ ${fmt(memAfter.external - memBefore.external)})`,
  )

  // Peak RSS via os.cpus isn't available, but we can log the final state
  const totalMem = os.totalmem()
  console.log(`  System total: ${fmt(totalMem)}`)
  console.log(`  RSS % of system: ${((memAfter.rss / totalMem) * 100).toFixed(2)}%`)

  if (tmpDir) {
    console.log()
    console.log(`  Saved PNGs: ${tmpDir}`)
  }

  console.log()
  app.quit()
}

app
  .whenReady()
  .then(run)
  .catch((err) => {
    console.error('Benchmark failed:', err)
    app.quit()
    process.exitCode = 1
  })
