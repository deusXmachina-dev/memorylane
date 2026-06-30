import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import sharp from 'sharp'
import { promoteCapture } from './promote-fixture'
import { parseGoldenMd } from './golden-md'

vi.mock('@main/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

/** Writes one live activity to the staging dir, as the in-app recorder would. */
function writeLiveActivity(dir: string, summary: string): void {
  fs.writeFileSync(
    path.join(dir, 'activities.jsonl'),
    JSON.stringify({
      id: 'live-1',
      startTimestamp: T0,
      endTimestamp: T0 + 1000,
      appName: 'Code',
      windowTitle: 'auth.ts',
      tld: '',
      summary,
      summaryModel: 'video',
    }) + '\n',
  )
}

let tmp: string
let sourceDir: string
let fixturesRoot: string

const T0 = 1_700_000_000_000

async function makePng(filepath: string, shade: number): Promise<void> {
  await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: shade, g: shade, b: shade } },
  })
    .png()
    .toFile(filepath)
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'promote-test-'))
  sourceDir = path.join(tmp, 'staging')
  fixturesRoot = path.join(tmp, 'fixtures')
  const srcFrames = path.join(sourceDir, 'src-frames')
  fs.mkdirSync(srcFrames, { recursive: true })

  const f1 = path.join(srcFrames, 'frame-0001.png')
  const f2 = path.join(srcFrames, 'frame-0002.png')
  await makePng(f1, 0)
  await makePng(f2, 255)

  const frames = [
    { filepath: f1, timestamp: T0, width: 64, height: 64, displayId: 1, sequenceNumber: 1 },
    { filepath: f2, timestamp: T0 + 1000, width: 64, height: 64, displayId: 1, sequenceNumber: 2 },
  ]
  fs.writeFileSync(
    path.join(sourceDir, 'frames.jsonl'),
    frames.map((f) => JSON.stringify(f)).join('\n') + '\n',
  )

  const window = {
    id: 'w1',
    startTimestamp: T0,
    endTimestamp: T0 + 1000,
    events: [
      {
        type: 'app_change',
        timestamp: T0,
        activeWindow: { title: 'auth.ts', processName: 'Code' },
      },
      {
        type: 'keyboard',
        timestamp: T0 + 500,
        activeWindow: { title: 'auth.ts', processName: 'Code' },
      },
    ],
    closedBy: 'gap',
  }
  fs.writeFileSync(path.join(sourceDir, 'event-windows.jsonl'), JSON.stringify(window) + '\n')
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('promoteCapture', () => {
  it('copies frames + event windows and writes a manifest (no seed/video)', async () => {
    const result = await promoteCapture({
      sourceDir,
      fixturesRoot,
      name: 'demo',
      seed: false,
      video: false,
    })

    expect(result.frameCount).toBe(2)
    expect(result.missingFrames).toBe(0)
    expect(result.eventWindowCount).toBe(1)
    expect(result.appMix).toEqual(['Code'])

    const fxDir = path.join(fixturesRoot, 'demo')
    expect(fs.existsSync(path.join(fxDir, 'event-windows.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(fxDir, 'frames', 'frame-0001.png'))).toBe(true)
    expect(fs.existsSync(path.join(fxDir, 'golden.md'))).toBe(false)
    expect(fs.existsSync(path.join(fxDir, 'session.mp4'))).toBe(false)

    // frame paths rewritten to relative.
    const promoted = fs
      .readFileSync(path.join(fxDir, 'frames.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { filepath: string })
    expect(promoted.every((f) => f.filepath.startsWith('frames/'))).toBe(true)

    const manifest = JSON.parse(fs.readFileSync(path.join(fxDir, 'manifest.json'), 'utf8'))
    expect(manifest.name).toBe('demo')
    expect(manifest.frameCount).toBe(2)
    expect(manifest.eventWindowCount).toBe(1)

    // event-windows copied verbatim.
    const copied = fs.readFileSync(path.join(fxDir, 'event-windows.jsonl'), 'utf8')
    const original = fs.readFileSync(path.join(sourceDir, 'event-windows.jsonl'), 'utf8')
    expect(copied).toBe(original)
  })

  it('seeds an editable golden.md from the live summaries, round-trips, no comment', async () => {
    writeLiveActivity(sourceDir, 'Live captured summary.')

    const result = await promoteCapture({
      sourceDir,
      fixturesRoot,
      name: 'demo2',
      seed: true,
      video: false,
    })

    expect(result.golden?.seeded).toBe(true)
    expect(result.golden?.summariesFilled).toBe(1)

    const golden = fs.readFileSync(path.join(fixturesRoot, 'demo2', 'golden.md'), 'utf8')
    expect(golden.startsWith('# Golden — demo2')).toBe(true)
    // Kept block carries the real capture-time summary, not a placeholder.
    expect(golden).toContain('Live captured summary.')
    expect(golden).not.toContain('no summary produced')
    // The confusing scaffold instruction comment is gone.
    expect(golden).not.toContain('Exact transcript scaffolded')

    const kept = parseGoldenMd(golden).find((b) => !b.dropped)
    expect(kept?.summary).toBe('Live captured summary.')
  })

  it('does not overwrite an existing golden.md unless reseed', async () => {
    writeLiveActivity(sourceDir, 'Live captured summary.')
    const fxDir = path.join(fixturesRoot, 'demo3')
    fs.mkdirSync(fxDir, { recursive: true })
    fs.writeFileSync(path.join(fxDir, 'golden.md'), 'CUSTOM EDIT', 'utf8')

    const result = await promoteCapture({
      sourceDir,
      fixturesRoot,
      name: 'demo3',
      seed: true,
      video: false,
    })

    expect(result.golden?.seeded).toBe(false)
    expect(fs.readFileSync(path.join(fxDir, 'golden.md'), 'utf8')).toBe('CUSTOM EDIT')
  })
})
