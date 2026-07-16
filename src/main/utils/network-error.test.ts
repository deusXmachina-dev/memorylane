import { describe, expect, it } from 'vitest'
import { describeNetworkError, networkErrorCode } from './network-error'

function fetchFailed(code?: string): TypeError {
  const cause =
    code !== undefined ? Object.assign(new Error(`syscall failed ${code}`), { code }) : undefined
  return new TypeError('fetch failed', cause !== undefined ? { cause } : undefined)
}

describe('networkErrorCode', () => {
  it('reads the code from the direct cause', () => {
    expect(networkErrorCode(fetchFailed('ENOTFOUND'))).toBe('ENOTFOUND')
  })

  it('walks nested cause chains', () => {
    const inner = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    const error = new TypeError('fetch failed', { cause: new Error('wrapped', { cause: inner }) })
    expect(networkErrorCode(error)).toBe('ECONNREFUSED')
  })

  it('descends into AggregateError causes', () => {
    const aggregate = new AggregateError([
      Object.assign(new Error('connect ECONNREFUSED ::1'), { code: 'ECONNREFUSED' }),
    ])
    expect(networkErrorCode(new TypeError('fetch failed', { cause: aggregate }))).toBe(
      'ECONNREFUSED',
    )
  })

  it('returns undefined when no code exists', () => {
    expect(networkErrorCode(fetchFailed())).toBeUndefined()
    expect(networkErrorCode('not an error')).toBeUndefined()
  })
})

describe('describeNetworkError', () => {
  it.each(['ENOTFOUND', 'EAI_AGAIN'])('maps %s to the DNS message', (code) => {
    expect(describeNetworkError(fetchFailed(code))).toMatch(/DNS or proxy settings/)
  })

  it.each(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_SOCKET'])(
    'maps %s to the unreachable-server message',
    (code) => {
      expect(describeNetworkError(fetchFailed(code))).toMatch(/firewall or proxy/)
    },
  )

  it.each(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'])(
    'maps %s to the timeout message',
    (code) => {
      expect(describeNetworkError(fetchFailed(code))).toMatch(/timed out/i)
    },
  )

  it.each(['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED'])(
    'maps %s to the TLS message',
    (code) => {
      expect(describeNetworkError(fetchFailed(code))).toMatch(/secure connection failed/i)
    },
  )

  it('keeps unknown codes visible in the generic message', () => {
    expect(describeNetworkError(fetchFailed('UND_ERR_WEIRD'))).toBe(
      'Network error (UND_ERR_WEIRD). Check your connection and try again.',
    )
  })

  it('maps a bare fetch failure without a code to the generic message', () => {
    expect(describeNetworkError(fetchFailed())).toBe(
      'Network error. Check your connection and try again.',
    )
  })

  it('maps abort/timeout errors', () => {
    const abort = new Error('This operation was aborted')
    abort.name = 'AbortError'
    expect(describeNetworkError(abort)).toMatch(/timed out/i)
  })

  it('returns null for non-network errors', () => {
    expect(describeNetworkError(new Error('boom'))).toBeNull()
    expect(describeNetworkError(new Error('Invalid activation code'))).toBeNull()
    expect(
      describeNetworkError(Object.assign(new Error('x'), { code: 'ERR_INVALID_ARG_TYPE' })),
    ).toBeNull()
    expect(describeNetworkError(undefined)).toBeNull()
  })
})
