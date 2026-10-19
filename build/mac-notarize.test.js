import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const { notarizeWithRetry, deps } = createRequire(import.meta.url)('./mac-notarize.js')

const opts = { appPath: '/tmp/MemoryLane.app', appleId: 'a', appleIdPassword: 'b', teamId: 'T' }
const stapleError = () => new Error('Failed to staple your application with code: 68\n\nError 68.')
const original = { ...deps }

describe('notarizeWithRetry', () => {
  beforeEach(() => {
    deps.notarize = vi.fn()
    deps.execFile = vi.fn()
    deps.sleep = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    Object.assign(deps, original)
    vi.restoreAllMocks()
  })

  it('re-runs stapler after a staple failure without re-submitting', async () => {
    deps.notarize.mockRejectedValueOnce(stapleError())
    deps.execFile
      .mockRejectedValueOnce(new Error('CloudKit lost'))
      .mockRejectedValueOnce(new Error('CloudKit lost'))
      .mockResolvedValueOnce({ stdout: '', stderr: '' })

    await notarizeWithRetry(opts)

    expect(deps.notarize).toHaveBeenCalledTimes(1)
    expect(deps.execFile).toHaveBeenCalledTimes(3)
    expect(deps.execFile).toHaveBeenCalledWith('xcrun', [
      'stapler',
      'staple',
      '-v',
      '/tmp/MemoryLane.app',
    ])
    expect(deps.sleep).toHaveBeenCalledTimes(2)
    expect(deps.sleep).toHaveBeenCalledWith(30_000)
  })

  it('gives up stapling after 10 attempts', async () => {
    deps.notarize.mockRejectedValueOnce(stapleError())
    deps.execFile.mockRejectedValue(new Error('CloudKit lost'))

    await expect(notarizeWithRetry(opts)).rejects.toThrow('CloudKit lost')

    expect(deps.execFile).toHaveBeenCalledTimes(10)
    expect(deps.sleep).toHaveBeenCalledTimes(9)
  })

  it('re-submits on non-staple failures', async () => {
    deps.notarize
      .mockRejectedValueOnce(new Error('Failed to notarize via notarytool'))
      .mockRejectedValueOnce(new Error('Failed with unexpected result'))
      .mockResolvedValueOnce(undefined)

    await notarizeWithRetry(opts)

    expect(deps.notarize).toHaveBeenCalledTimes(3)
    expect(deps.execFile).not.toHaveBeenCalled()
    expect(deps.sleep).toHaveBeenCalledWith(60_000)
  })

  it('gives up submitting after 3 attempts', async () => {
    deps.notarize.mockRejectedValue(new Error('Failed to notarize via notarytool'))

    await expect(notarizeWithRetry(opts)).rejects.toThrow('Failed to notarize via notarytool')

    expect(deps.notarize).toHaveBeenCalledTimes(3)
    expect(deps.sleep).toHaveBeenCalledTimes(2)
  })
})
