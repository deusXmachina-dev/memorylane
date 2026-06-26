import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { readManagedCapturePolicy, writeManagedCapturePolicy } from './managed-capture-policy-store'

const TMP_FILE = path.join(os.tmpdir(), 'memorylane-managed-capture-policy.test.json')

describe('managed-capture-policy-store', () => {
  afterEach(() => {
    try {
      fs.unlinkSync(TMP_FILE)
    } catch {
      // already gone
    }
  })

  it('round-trips a policy through write then read', () => {
    const policy = { apps: ['slack', 'msedge'], urlPatterns: ['*bank*'] }
    writeManagedCapturePolicy(policy, TMP_FILE)
    expect(readManagedCapturePolicy(TMP_FILE)).toEqual(policy)
  })

  it('returns null when the file is missing', () => {
    expect(readManagedCapturePolicy(TMP_FILE)).toBeNull()
  })

  it('returns null on corrupt JSON', () => {
    fs.writeFileSync(TMP_FILE, '{ not valid json')
    expect(readManagedCapturePolicy(TMP_FILE)).toBeNull()
  })

  it('drops non-string entries and missing fields on read', () => {
    fs.writeFileSync(TMP_FILE, JSON.stringify({ apps: ['slack', 1, null, 'code'] }))
    expect(readManagedCapturePolicy(TMP_FILE)).toEqual({
      apps: ['slack', 'code'],
      urlPatterns: [],
    })
  })
})
