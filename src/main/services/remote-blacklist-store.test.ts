import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { readRemoteBlacklist, writeRemoteBlacklist } from './remote-blacklist-store'

const TMP_FILE = path.join(os.tmpdir(), 'memorylane-remote-blacklist.test.json')

describe('remote-blacklist-store', () => {
  afterEach(() => {
    try {
      fs.unlinkSync(TMP_FILE)
    } catch {
      // already gone
    }
  })

  it('round-trips a blacklist through write then read', () => {
    const blacklist = { apps: ['slack', 'msedge'], urlPatterns: ['*bank*'] }
    writeRemoteBlacklist(blacklist, TMP_FILE)
    expect(readRemoteBlacklist(TMP_FILE)).toEqual(blacklist)
  })

  it('returns null when the file is missing', () => {
    expect(readRemoteBlacklist(TMP_FILE)).toBeNull()
  })

  it('returns null on corrupt JSON', () => {
    fs.writeFileSync(TMP_FILE, '{ not valid json')
    expect(readRemoteBlacklist(TMP_FILE)).toBeNull()
  })

  it('drops non-string entries and missing fields on read', () => {
    fs.writeFileSync(TMP_FILE, JSON.stringify({ apps: ['slack', 1, null, 'code'] }))
    expect(readRemoteBlacklist(TMP_FILE)).toEqual({
      apps: ['slack', 'code'],
      urlPatterns: [],
    })
  })
})
