import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { TaskFixtureStore, sanitizeFixtureName } from './task-fixture-store'
import { TASK_FIXTURE_SCHEMA_VERSION, type TaskFixtureActivity } from './task-types'

vi.mock('../logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

let root: string
let store: TaskFixtureStore

const ACTS: TaskFixtureActivity[] = [
  {
    id: 'a1',
    offsetMin: 540,
    durationMin: 5,
    app: 'Chrome',
    windowTitle: 'Tab',
    tld: 'example.com',
    summary: 'did a thing',
    ocrText: 'OCR',
  },
]

function manifest(name: string) {
  return {
    name,
    label: `Label ${name}`,
    description: 'desc',
    activityCount: ACTS.length,
    sourceDay: '2026-06-10',
    schemaVersion: TASK_FIXTURE_SCHEMA_VERSION,
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-fixture-store-test-'))
  store = new TaskFixtureStore(root)
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('sanitizeFixtureName', () => {
  it('produces a filesystem-safe single segment', () => {
    expect(sanitizeFixtureName('OpenRouter credits / 2026-06-10')).toBe(
      'OpenRouter-credits-2026-06-10',
    )
    expect(sanitizeFixtureName('   ')).toBe('fixture')
    expect(sanitizeFixtureName('../../etc/passwd')).toBe('etc-passwd')
  })
})

describe('TaskFixtureStore', () => {
  it('writes the three fixture files and lists them', () => {
    const summary = store.write('alpha', ACTS, '# Golden — alpha', manifest('alpha'))
    expect(summary.name).toBe('alpha')
    expect(summary.activityCount).toBe(1)
    expect(summary.sourceDay).toBe('2026-06-10')

    const dir = path.join(root, 'alpha')
    expect(fs.existsSync(path.join(dir, 'activities.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'golden.md'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true)

    const jsonl = fs.readFileSync(path.join(dir, 'activities.jsonl'), 'utf8').trim()
    expect(JSON.parse(jsonl)).toMatchObject({ id: 'a1', offsetMin: 540 })

    const list = store.list()
    expect(list.map((f) => f.name)).toEqual(['alpha'])
    expect(list[0].label).toBe('Label alpha')
  })

  it('sanitizes the name on write', () => {
    const summary = store.write('My Golden!', ACTS, '# g', manifest('My Golden!'))
    expect(summary.name).toBe('My-Golden')
    expect(fs.existsSync(path.join(root, 'My-Golden', 'manifest.json'))).toBe(true)
  })

  it('loads and saves an edited golden', () => {
    store.write('alpha', ACTS, '# Golden — alpha', manifest('alpha'))
    expect(store.load('alpha')?.goldenMd).toBe('# Golden — alpha')

    store.saveGolden('alpha', '# edited')
    expect(store.load('alpha')?.goldenMd).toBe('# edited')
  })

  it('returns null for a missing fixture', () => {
    expect(store.load('nope')).toBeNull()
  })

  it('exports a non-empty zip', async () => {
    store.write('alpha', ACTS, '# g', manifest('alpha'))
    const dest = path.join(root, 'out', 'alpha.zip')
    await store.exportZip('alpha', dest)
    const bytes = fs.readFileSync(dest)
    expect(bytes.length).toBeGreaterThan(0)
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('deletes a fixture', () => {
    store.write('alpha', ACTS, '# g', manifest('alpha'))
    store.delete('alpha')
    expect(store.list()).toEqual([])
  })
})
