const CONNECT_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_SOCKET',
])
const TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
])

function isTlsCode(code: string): boolean {
  return (
    code.startsWith('ERR_TLS') ||
    code.startsWith('ERR_SSL') ||
    code.startsWith('CERT_') ||
    // OpenSSL verification failures: UNABLE_TO_GET_ISSUER_CERT_LOCALLY (common
    // behind TLS-intercepting corporate proxies), UNABLE_TO_VERIFY_LEAF_SIGNATURE, …
    code.startsWith('UNABLE_TO_') ||
    code.includes('SELF_SIGNED')
  )
}

/** Best-effort error code from the undici/Node cause chain (e.g. ENOTFOUND). */
export function networkErrorCode(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 4; depth++) {
    if (!(current instanceof Error)) return undefined
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && code !== '') return code
    current =
      current instanceof AggregateError && current.errors.length > 0
        ? current.errors[0]
        : current.cause
  }
  return undefined
}

/**
 * Brief user-facing message for a fetch() transport rejection, or null if the
 * error is not a network transport failure.
 */
export function describeNetworkError(error: unknown): string | null {
  const code = networkErrorCode(error)
  if (code !== undefined) {
    if (CONNECT_CODES.has(code)) {
      return "Can't reach the server. Check your internet connection and try again."
    }
    if (TIMEOUT_CODES.has(code)) {
      return 'The connection timed out. Check your internet connection and try again.'
    }
    if (isTlsCode(code)) {
      return "Couldn't set up a secure connection. If you're on a company network, ask your IT department."
    }
  }
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'The connection timed out. Check your internet connection and try again.'
  }
  if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
    return code !== undefined
      ? `Connection problem (${code}). Check your internet connection and try again.`
      : 'Connection problem. Check your internet connection and try again.'
  }
  return null
}

/** A network transport failure rewritten with a user-facing message. */
export class NetworkError extends Error {}

/**
 * NetworkError with a user-facing message when the error is a transport
 * failure; the original error otherwise.
 */
export function toUserFacingError(error: unknown): unknown {
  const friendly = describeNetworkError(error)
  return friendly !== null ? new NetworkError(friendly) : error
}
