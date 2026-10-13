import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseExport } from './database-export'

describe('DatabaseExport', () => {
  let tmpDir: string | null = null

  afterEach(async () => {
    vi.useRealTimers()
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      tmpDir = null
    }
  })

  it('exports the raw database to the configured directory', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-raw-export-'))
    const backupToFile = vi.fn(async (destinationPath: string) => {
      fs.writeFileSync(destinationPath, 'snapshot')
    })

    const sync = new DatabaseExport({
      storage: { backupToFile },
      getExportDirectory: () => tmpDir ?? '',
      getInstallationId: () => 'abc123def4567890',
    })

    await sync.exportNow('test')

    const outputPath = path.join(tmpDir, 'memorylane-abc123def4567890.db')
    expect(backupToFile).toHaveBeenCalledTimes(1)
    expect(fs.readFileSync(outputPath, 'utf-8')).toBe('snapshot')
  })

  it('skips export when no directory is configured', async () => {
    const backupToFile = vi.fn(async (destinationPath: string) => {
      fs.writeFileSync(destinationPath, 'snapshot')
    })

    const sync = new DatabaseExport({
      storage: { backupToFile },
      getExportDirectory: () => '',
      getInstallationId: () => 'abc123def4567890',
    })

    await sync.exportNow('test')

    expect(backupToFile).not.toHaveBeenCalled()
  })

  it('exports on startup and on the configured interval', async () => {
    vi.useFakeTimers()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-raw-export-'))
    const backupToFile = vi.fn(async (destinationPath: string) => {
      fs.writeFileSync(destinationPath, 'snapshot')
    })

    const sync = new DatabaseExport({
      storage: { backupToFile },
      getExportDirectory: () => tmpDir ?? '',
      getInstallationId: () => 'abc123def4567890',
      intervalMs: 1000,
    })

    sync.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(backupToFile).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(backupToFile).toHaveBeenCalledTimes(2)

    await sync.stop()
  })
})
