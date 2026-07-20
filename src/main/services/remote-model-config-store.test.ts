import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  coerceRemoteModelConfig,
  readRemoteModelConfig,
  writeRemoteModelConfig,
} from './remote-model-config-store'

const TMP_FILE = path.join(os.tmpdir(), 'memorylane-remote-model-config.test.json')

describe('coerceRemoteModelConfig', () => {
  it('accepts a valid payload and keeps chain order', () => {
    expect(
      coerceRemoteModelConfig({
        version: 3,
        models: {
          semanticVideo: ['google/gemini-3.1-flash-lite', 'google/gemini-2.5-flash'],
          taskMining: ['minimax/minimax-m3'],
        },
      }),
    ).toEqual({
      version: 3,
      models: {
        semanticVideo: ['google/gemini-3.1-flash-lite', 'google/gemini-2.5-flash'],
        taskMining: ['minimax/minimax-m3'],
      },
    })
  })

  it('rejects the whole payload on a bad version', () => {
    expect(coerceRemoteModelConfig({ version: -1, models: {} })).toBeNull()
    expect(coerceRemoteModelConfig({ version: 1.5, models: {} })).toBeNull()
    expect(coerceRemoteModelConfig({ version: '3', models: {} })).toBeNull()
    expect(coerceRemoteModelConfig({ models: {} })).toBeNull()
    expect(coerceRemoteModelConfig(null)).toBeNull()
    expect(coerceRemoteModelConfig('nope')).toBeNull()
  })

  it('accepts version 0 with no models as the no-opinion bootstrap', () => {
    expect(coerceRemoteModelConfig({ version: 0 })).toEqual({ version: 0, models: {} })
  })

  it('drops invalid chain entries, dedupes, and caps at 8', () => {
    const config = coerceRemoteModelConfig({
      version: 1,
      models: {
        semanticVideo: [
          '  google/gemini-2.5-flash  ',
          'google/gemini-2.5-flash',
          42,
          '',
          'bad id with spaces',
          '-leading-dash',
          'x'.repeat(129),
          ...Array.from({ length: 10 }, (_, i) => `vendor/model-${i}`),
        ],
      },
    })
    expect(config?.models.semanticVideo).toEqual([
      'google/gemini-2.5-flash',
      ...Array.from({ length: 7 }, (_, i) => `vendor/model-${i}`),
    ])
  })

  it('omits empty slots and ignores unknown keys', () => {
    const config = coerceRemoteModelConfig({
      version: 2,
      models: {
        semanticVideo: [],
        embeddings: ['some/model'],
        userContext: ['minimax/minimax-m3'],
      },
    })
    expect(config).toEqual({ version: 2, models: { userContext: ['minimax/minimax-m3'] } })
  })
})

describe('remote-model-config-store', () => {
  afterEach(() => {
    try {
      fs.unlinkSync(TMP_FILE)
    } catch {
      // already gone
    }
  })

  it('round-trips a config through write then read', () => {
    const config = { version: 4, models: { taskMining: ['minimax/minimax-m3'] } }
    writeRemoteModelConfig(config, TMP_FILE)
    expect(readRemoteModelConfig(TMP_FILE)).toEqual(config)
  })

  it('returns null when the file is missing', () => {
    expect(readRemoteModelConfig(TMP_FILE)).toBeNull()
  })

  it('returns null on corrupt JSON', () => {
    fs.writeFileSync(TMP_FILE, '{ not valid json')
    expect(readRemoteModelConfig(TMP_FILE)).toBeNull()
  })

  it('returns null on a hand-edited file with an invalid version', () => {
    fs.writeFileSync(TMP_FILE, JSON.stringify({ version: 'latest', models: {} }))
    expect(readRemoteModelConfig(TMP_FILE)).toBeNull()
  })
})
