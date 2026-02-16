/**
 * Manual integration test for window capture via desktopCapturer.
 *
 * Usage:
 *   npx electron scripts/test-window-capture.mjs
 *
 * This runs inside a full Electron main process so desktopCapturer is available.
 * It captures windows and saves PNGs to a temp directory for visual inspection.
 */
import { app, desktopCapturer } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Same matching logic as window-capture.ts findMatchingSource */
function findMatchingSource(sources, title) {
  if (sources.length === 0) return null
  if (!title) return sources[0]
  const lower = title.toLowerCase()
  return sources.find((s) => s.name.toLowerCase().includes(lower)) ?? null
}

/** Same logic as window-capture.ts captureWindow */
async function captureWindow(options = {}) {
  const { title, thumbnailSize = { width: 1920 * 2, height: 1080 * 2 } } = options
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize })
  const source = findMatchingSource(sources, title)
  if (!source) return null
  const size = source.thumbnail.getSize()
  return {
    image: source.thumbnail.toPNG(),
    sourceId: source.id,
    title: source.name,
    width: size.width,
    height: size.height,
  }
}

async function run() {
  const outDir = join(app.getPath('temp'), 'memorylane-window-capture-test')
  mkdirSync(outDir, { recursive: true })
  console.log(`\nOutput directory: ${outDir}\n`)

  // List all available windows
  console.log('--- Available windows ---')
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 320, height: 180 },
  })
  for (const s of sources) {
    const size = s.thumbnail.getSize()
    console.log(`  [${s.id}] "${s.name}" (${size.width}x${size.height})`)
  }

  // Test 1: Capture frontmost window
  console.log('\n--- Test 1: Capture frontmost window ---')
  const frontmost = await captureWindow()
  if (frontmost) {
    const outPath = join(outDir, 'frontmost.png')
    writeFileSync(outPath, frontmost.image)
    console.log(`  Title:  "${frontmost.title}"`)
    console.log(`  Size:   ${frontmost.width}x${frontmost.height}`)
    console.log(`  Saved:  ${outPath}`)
  } else {
    console.log('  No window captured')
  }

  // Test 2: Capture by title — try common app names
  const testTitles = ['Terminal', 'Chrome', 'Safari', 'Code', 'Finder']
  for (const title of testTitles) {
    console.log(`\n--- Test: Capture window matching "${title}" ---`)
    const result = await captureWindow({ title })
    if (result) {
      const safeName = title.toLowerCase().replace(/[^a-z0-9]/g, '-')
      const outPath = join(outDir, `${safeName}.png`)
      writeFileSync(outPath, result.image)
      console.log(`  Title:  "${result.title}"`)
      console.log(`  Size:   ${result.width}x${result.height}`)
      console.log(`  Saved:  ${outPath}`)
    } else {
      console.log(`  No window matching "${title}"`)
    }
  }

  console.log(`\nDone. Check ${outDir} for screenshots.\n`)
}

app
  .whenReady()
  .then(run)
  .then(() => app.quit())
