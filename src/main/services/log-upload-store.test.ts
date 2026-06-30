import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { readLogUploadState, writeLogUploadState } from './log-upload-store'

const TMP_FILE = path.join(os.tmpdir(), 'memorylane-log-upload-state.test.json')

describe('log-upload-store', () => {
  afterEach(() => {
    try {
      fs.unlinkSync(TMP_FILE)
    } catch {
      // already gone
    }
  })

  it('round-trips a state through write then read', () => {
    const state = { lastUploadAt: 1_700_000_000_000, lastSig: 'main.log:123:456' }
    writeLogUploadState(state, TMP_FILE)
    expect(readLogUploadState(TMP_FILE)).toEqual(state)
  })

  it('returns null when the file is missing', () => {
    expect(readLogUploadState(TMP_FILE)).toBeNull()
  })

  it('returns null on corrupt JSON', () => {
    fs.writeFileSync(TMP_FILE, '{ not valid json')
    expect(readLogUploadState(TMP_FILE)).toBeNull()
  })

  it('coerces missing or wrong-typed fields to null', () => {
    fs.writeFileSync(TMP_FILE, JSON.stringify({ lastUploadAt: 'nope' }))
    expect(readLogUploadState(TMP_FILE)).toEqual({ lastUploadAt: null, lastSig: null })
  })
})
