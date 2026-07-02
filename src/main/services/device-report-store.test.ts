import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { readDeviceReportState, writeDeviceReportState } from './device-report-store'

const TMP_FILE = path.join(os.tmpdir(), 'memorylane-device-report-state.test.json')

describe('device-report-store', () => {
  afterEach(() => {
    try {
      fs.unlinkSync(TMP_FILE)
    } catch {
      // already gone
    }
  })

  it('round-trips a state through write then read', () => {
    const state = { version: '1.3.0' }
    writeDeviceReportState(state, TMP_FILE)
    expect(readDeviceReportState(TMP_FILE)).toEqual(state)
  })

  it('returns null when the file is missing', () => {
    expect(readDeviceReportState(TMP_FILE)).toBeNull()
  })

  it('returns null on corrupt JSON', () => {
    fs.writeFileSync(TMP_FILE, '{ not valid json')
    expect(readDeviceReportState(TMP_FILE)).toBeNull()
  })

  it('coerces a missing or wrong-typed version to null', () => {
    fs.writeFileSync(TMP_FILE, JSON.stringify({ version: 42 }))
    expect(readDeviceReportState(TMP_FILE)).toEqual({ version: null })
  })
})
