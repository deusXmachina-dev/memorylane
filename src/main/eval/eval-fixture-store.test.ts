import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { EvalFixtureStore } from './eval-fixture-store'
import type { FixtureManifest } from './types'

vi.mock('../logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

let root: string
let store: EvalFixtureStore

function writeFixture(name: string, opts: { video?: boolean; golden?: string } = {}): void {
  const dir = path.join(root, name)
  fs.mkdirSync(path.join(dir, 'frames'), { recursive: true })
  const manifest: FixtureManifest = {
    name,
    label: `Label ${name}`,
    description: '',
    capturedAt: new Date(T0).toISOString(),
    platform: 'darwin',
    appMix: ['Code', 'Chrome'],
    frameCount: 3,
    eventWindowCount: 2,
    schemaVersion: 1,
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8')
  fs.writeFileSync(path.join(dir, 'golden.md'), opts.golden ?? '# Golden — ' + name, 'utf8')
  fs.writeFileSync(path.join(dir, 'frames', 'frame-0001.png'), 'PNGDATA', 'utf8')
  if (opts.video) fs.writeFileSync(path.join(dir, 'session.mp4'), 'MP4DATA', 'utf8')
}

const T0 = 1_700_000_000_000

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-store-test-'))
  store = new EvalFixtureStore(root)
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('EvalFixtureStore', () => {
  it('lists fixtures and ignores the staging dir', () => {
    writeFixture('alpha', { video: true })
    writeFixture('beta')
    fs.mkdirSync(path.join(root, '.staging', 'in-progress'), { recursive: true })

    const list = store.list()
    expect(list.map((f) => f.name).sort()).toEqual(['alpha', 'beta'])
    const alpha = list.find((f) => f.name === 'alpha')
    expect(alpha?.hasVideo).toBe(true)
    expect(alpha?.appMix).toEqual(['Code', 'Chrome'])
    expect(list.find((f) => f.name === 'beta')?.hasVideo).toBe(false)
  })

  it('loads golden + a streamable video URL', () => {
    writeFixture('alpha', { video: true, golden: '# Golden — alpha\n\nhi' })
    const loaded = store.load('alpha')
    expect(loaded?.goldenMd).toBe('# Golden — alpha\n\nhi')
    expect(loaded?.videoUrl).toBe('mlmedia://eval/alpha/session.mp4')

    const noVideo = (writeFixture('beta'), store.load('beta'))
    expect(noVideo?.videoUrl).toBeNull()
  })

  it('loads interaction events grouped by window, anchored to the first frame', () => {
    writeFixture('alpha')
    const dir = path.join(root, 'alpha')
    // Earliest frame is the session-clock zero; events offset from it.
    fs.writeFileSync(
      path.join(dir, 'frames.jsonl'),
      [
        JSON.stringify({ filepath: 'frames/f2.png', timestamp: T0 + 5_000 }),
        JSON.stringify({ filepath: 'frames/f1.png', timestamp: T0 + 1_000 }),
      ].join('\n'),
      'utf8',
    )
    fs.writeFileSync(
      path.join(dir, 'event-windows.jsonl'),
      [
        JSON.stringify({
          id: 'w1',
          startTimestamp: T0 + 1_000,
          endTimestamp: T0 + 4_000,
          closedBy: 'gap',
          events: [
            { type: 'presence', timestamp: T0 + 1_000 },
            {
              type: 'click',
              timestamp: T0 + 3_000,
              activeWindow: { title: 'github.com', processName: 'Chrome' },
            },
            { type: 'keyboard', timestamp: T0 + 2_000, keyCount: 45 },
          ],
        }),
      ].join('\n'),
      'utf8',
    )

    const loaded = store.load('alpha')
    expect(loaded?.eventWindows).toHaveLength(1)
    const w = loaded!.eventWindows[0]
    expect(w.closedBy).toBe('gap')
    expect(w.startOffsetMs).toBe(0) // T0+1000 - sessionStart(T0+1000)
    expect(w.endOffsetMs).toBe(3_000)
    expect(w.appLabel).toBe('Chrome — github.com')
    // Presence dropped; remaining sorted by timestamp; text matches the prompt formatter.
    expect(w.events).toEqual([
      { offsetMs: 1_000, type: 'keyboard', text: 'typing session (45 keys)' },
      { offsetMs: 2_000, type: 'click', text: 'mouse click' },
    ])
  })

  it('returns [] event windows when the file is absent', () => {
    writeFixture('alpha')
    expect(store.load('alpha')?.eventWindows).toEqual([])
  })

  it('returns null when loading a missing fixture', () => {
    expect(store.load('nope')).toBeNull()
  })

  it('saves an edited golden', () => {
    writeFixture('alpha')
    store.saveGolden('alpha', '# Golden — alpha\n\nedited summary')
    expect(store.load('alpha')?.goldenMd).toBe('# Golden — alpha\n\nedited summary')
  })

  it('exports a fixture to a non-empty zip', async () => {
    writeFixture('alpha', { video: true })
    const dest = path.join(root, 'out', 'alpha.zip')
    await store.exportZip('alpha', dest)
    expect(fs.existsSync(dest)).toBe(true)
    const bytes = fs.readFileSync(dest)
    expect(bytes.length).toBeGreaterThan(0)
    // ZIP local file header magic.
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('deletes a fixture', () => {
    writeFixture('alpha')
    store.delete('alpha')
    expect(store.list()).toEqual([])
    expect(fs.existsSync(path.join(root, 'alpha'))).toBe(false)
  })
})
