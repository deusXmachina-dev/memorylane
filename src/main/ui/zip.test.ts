import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { open as openZip } from 'yauzl'
import { buildTimestampedZipName, createZipWithFiles, ensureZipExtension } from './zip'

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

describe('buildTimestampedZipName', () => {
  it('formats a zero-padded timestamp with the given prefix', () => {
    const name = buildTimestampedZipName('memorylane-logs-export', new Date(2026, 5, 1, 9, 8, 7))
    expect(name).toBe('memorylane-logs-export-20260601-090807.zip')
  })
})

describe('ensureZipExtension', () => {
  it('appends .zip when missing', () => {
    expect(ensureZipExtension('/tmp/out')).toBe('/tmp/out.zip')
  })

  it('leaves an existing extension untouched regardless of case', () => {
    expect(ensureZipExtension('/tmp/out.zip')).toBe('/tmp/out.zip')
    expect(ensureZipExtension('/tmp/out.ZIP')).toBe('/tmp/out.ZIP')
  })
})

describe('createZipWithFiles', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'zip-test-'))
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

    await createZipWithFiles([a, b], outputZip)

    expect(fs.existsSync(outputZip)).toBe(true)
    const entries = (await listZipEntries(outputZip)).sort()
    expect(entries).toEqual(['main.log', 'main.old.log'])
  })
})
