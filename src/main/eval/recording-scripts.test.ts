import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RecordingScript } from '@/shared/eval-review'
import {
  getRecordingScript,
  importRecordingScripts,
  listRecordingScripts,
  parseRecordingScripts,
} from './recording-scripts'

const script = (id: string, title = id): RecordingScript => ({
  id,
  title,
  targets: [],
  setup: [],
  steps: [{ instruction: 'Type', seconds: 5, expect: { app: ['TextEdit'] } }],
})

const tmpDirs: string[] = []
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenarios-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('recording scripts', () => {
  it('is empty until a file is imported', () => {
    expect(listRecordingScripts(tmp())).toEqual([])
  })

  it('imports and merges by id', () => {
    const root = tmp()
    const a = path.join(tmp(), 'a.json')
    const b = path.join(tmp(), 'b.json')
    fs.writeFileSync(a, JSON.stringify([script('one'), script('two')]))
    fs.writeFileSync(b, JSON.stringify([script('two', 'Two v2'), script('three')]))

    expect(importRecordingScripts(root, a)).toBe(2)
    expect(importRecordingScripts(root, b)).toBe(2)
    expect(listRecordingScripts(root).map((s) => s.id)).toEqual(['one', 'two', 'three'])
    expect(getRecordingScript(root, 'two')?.title).toBe('Two v2')
  })

  it('rejects consecutive steps the pipeline could not tell apart', () => {
    const step = (app: string, tld?: string): RecordingScript['steps'][number] => ({
      instruction: '',
      seconds: 5,
      expect: { app: [app], tld },
    })
    const twin = { ...script('twin'), steps: [step('Ghostty'), step('Ghostty')] }
    expect(() => parseRecordingScripts(JSON.stringify([twin]), { lint: true })).toThrow(
      'Scenario twin: steps 1 and 2 are both Ghostty — merge them into one step',
    )
    const sites = {
      ...script('sites'),
      steps: [step('browser', 'calendar.google.com'), step('browser', 'mail.google.com')],
    }
    expect(parseRecordingScripts(JSON.stringify([sites]))).toHaveLength(1)
    const hop = {
      ...script('hop'),
      steps: [
        step('browser', 'github.com'),
        { ...step('browser'), expect: { app: ['browser'], dropped: true as const } },
      ],
    }
    expect(parseRecordingScripts(JSON.stringify([hop]))).toHaveLength(1)
  })

  it('rejects malformed files', () => {
    expect(() => parseRecordingScripts('{}')).toThrow('JSON array')
    expect(() => parseRecordingScripts(JSON.stringify([{ id: 'x', title: 'x' }]))).toThrow(
      'Invalid scenario x',
    )
    expect(() => parseRecordingScripts(JSON.stringify([script('x'), script('x')]))).toThrow(
      'Duplicate',
    )
  })
})
