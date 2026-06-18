import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { collectLogFiles } from './logs-export'

async function makeTempDir(): Promise<string> {
  return fsPromises.mkdtemp(path.join(os.tmpdir(), 'logs-export-test-'))
}

describe('collectLogFiles', () => {
  let dir: string

  beforeEach(async () => {
    dir = await makeTempDir()
  })

  afterEach(async () => {
    await fsPromises.rm(dir, { recursive: true, force: true })
  })

  it('returns all .log files and ignores other files', () => {
    fs.writeFileSync(path.join(dir, 'main.log'), 'current')
    fs.writeFileSync(path.join(dir, 'main.old.log'), 'rotated')
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignore me')

    const found = collectLogFiles(dir)
      .map((p) => path.basename(p))
      .sort()
    expect(found).toEqual(['main.log', 'main.old.log'])
  })

  it('returns an empty array for a missing directory', () => {
    expect(collectLogFiles(path.join(dir, 'does-not-exist'))).toEqual([])
  })

  it('returns an empty array when there are no log files', () => {
    fs.writeFileSync(path.join(dir, 'readme.md'), 'no logs here')
    expect(collectLogFiles(dir)).toEqual([])
  })
})
