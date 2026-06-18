import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { open as openZip } from 'yauzl'
import { collectLogFiles, __testing } from './logs-export'

async function makeTempDir(): Promise<string> {
  return fsPromises.mkdtemp(path.join(os.tmpdir(), 'logs-export-test-'))
}

function listZipEntries(zipPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const names: string[] = []
    openZip(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('failed to open zip'))
      zip.on('entry', (entry: { fileName: string }) => {
        names.push(entry.fileName)
        zip.readEntry()
      })
      zip.on('end', () => resolve(names))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
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

describe('createZipWithFiles', () => {
  let dir: string

  beforeEach(async () => {
    dir = await makeTempDir()
  })

  afterEach(async () => {
    await fsPromises.rm(dir, { recursive: true, force: true })
  })

  it('bundles every input file as a flat entry named by basename', async () => {
    const a = path.join(dir, 'main.log')
    const b = path.join(dir, 'main.old.log')
    fs.writeFileSync(a, 'a')
    fs.writeFileSync(b, 'b')
    const outputZip = path.join(dir, 'out.zip')

    await __testing.createZipWithFiles([a, b], outputZip)

    expect(fs.existsSync(outputZip)).toBe(true)
    const entries = (await listZipEntries(outputZip)).sort()
    expect(entries).toEqual(['main.log', 'main.old.log'])
  })
})
