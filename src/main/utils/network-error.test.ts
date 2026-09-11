import { describe, expect, it } from 'vitest'
import { APICallError } from 'ai'
import {
  describeNetworkError,
  isPreRequestNetworkError,
  networkErrorCode,
  NetworkError,
  toUserFacingError,
} from './network-error'

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
  it.each([
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'UND_ERR_SOCKET',
  ])('maps %s to the unreachable-server message', (code) => {
    expect(describeNetworkError(fetchFailed(code))).toMatch(/can't reach the server/i)
  })

  it.each(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'])(
    'maps %s to the timeout message',
    (code) => {
      expect(describeNetworkError(fetchFailed(code))).toMatch(/timed out/i)
    },
  )

  it.each([
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'CERT_HAS_EXPIRED',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  ])('maps %s to the TLS message', (code) => {
    expect(describeNetworkError(fetchFailed(code))).toMatch(/secure connection/i)
  })

  it('keeps unknown codes visible in the generic message', () => {
    expect(describeNetworkError(fetchFailed('UND_ERR_WEIRD'))).toBe(
      'Connection problem (UND_ERR_WEIRD). Check your internet connection and try again.',
    )
  })

  it('maps a bare fetch failure without a code to the generic message', () => {
    expect(describeNetworkError(fetchFailed())).toBe(
      'Connection problem. Check your internet connection and try again.',
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

describe('toUserFacingError', () => {
  it('wraps transport failures in a NetworkError with the friendly message', () => {
    const mapped = toUserFacingError(fetchFailed('ENOTFOUND'))
    expect(mapped).toBeInstanceOf(NetworkError)
    expect((mapped as Error).message).toMatch(/can't reach the server/i)
  })

  it('returns non-network errors unchanged', () => {
    const original = new Error('Invalid activation code')
    expect(toUserFacingError(original)).toBe(original)
  })
})

describe('isPreRequestNetworkError', () => {
  it('is true when the request never left the machine', () => {
    const dns = new APICallError({
      message: 'Cannot connect to API: getaddrinfo ENOTFOUND openrouter.ai',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      requestBodyValues: {},
      cause: fetchFailed('ENOTFOUND'),
      isRetryable: true,
    })
    expect(isPreRequestNetworkError(dns)).toBe(true)
    expect(isPreRequestNetworkError(fetchFailed('ECONNREFUSED'))).toBe(true)
    expect(isPreRequestNetworkError(fetchFailed('UNABLE_TO_GET_ISSUER_CERT_LOCALLY'))).toBe(true)
    expect(isPreRequestNetworkError(fetchFailed())).toBe(true)
  })

  it('is false once the request may have reached the provider', () => {
    const deadline = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    expect(isPreRequestNetworkError(fetchFailed('ECONNRESET'))).toBe(false)
    expect(isPreRequestNetworkError(fetchFailed('UND_ERR_HEADERS_TIMEOUT'))).toBe(false)
    expect(isPreRequestNetworkError(deadline)).toBe(false)
    expect(isPreRequestNetworkError(new Error('boom'))).toBe(false)
  })
})
