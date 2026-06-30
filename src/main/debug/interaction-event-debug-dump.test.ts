import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { InteractionEventDebugDumper } from './interaction-event-debug-dump'
import type { InteractionContext } from '@/shared/types'

describe('InteractionEventDebugDumper', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-interaction-dump-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('appends one JSONL record per event, carrying dumpedAt and lagMs', () => {
    const dumper = new InteractionEventDebugDumper(dir)
    const scroll: InteractionContext = {
      type: 'scroll',
      timestamp: 1000,
      scrollAmount: 5,
      durationMs: 200,
    }
    const appChange: InteractionContext = { type: 'app_change', timestamp: 2000 }

    dumper.dump(scroll)
    dumper.dump(appChange)

    const lines = fs.readFileSync(dumper.getFilePath(), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)

    const first = JSON.parse(lines[0])
    expect(first).toMatchObject({
      type: 'scroll',
      timestamp: 1000,
      scrollAmount: 5,
      durationMs: 200,
    })
    expect(typeof first.dumpedAt).toBe('number')
    expect(first.lagMs).toBe(first.dumpedAt - 1000)

    const second = JSON.parse(lines[1])
    expect(second).toMatchObject({ type: 'app_change', timestamp: 2000 })
    expect(second.lagMs).toBe(second.dumpedAt - 2000)
  })

  it('creates the target directory if it does not exist', () => {
    const nested = path.join(dir, 'a', 'b')
    const dumper = new InteractionEventDebugDumper(nested)
    dumper.dump({ type: 'click', timestamp: 1 })
    expect(fs.existsSync(dumper.getFilePath())).toBe(true)
  })
})
