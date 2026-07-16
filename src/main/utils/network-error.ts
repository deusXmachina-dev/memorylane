const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN'])
const CONNECT_CODES = new Set([
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
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
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
    if (DNS_CODES.has(code)) {
      return "Can't reach the server. Check your internet connection and DNS or proxy settings."
    }
    if (CONNECT_CODES.has(code)) {
      return "Can't reach the server. Check your internet connection and any firewall or proxy."
    }
    if (TIMEOUT_CODES.has(code)) {
      return 'Connection timed out. Check your network and try again.'
    }
    if (isTlsCode(code)) {
      return 'Secure connection failed. A firewall or proxy may be intercepting traffic.'
    }
  }
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'Connection timed out. Check your network and try again.'
  }
  if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
    return code !== undefined
      ? `Network error (${code}). Check your connection and try again.`
      : 'Network error. Check your connection and try again.'
  }
  return null
}
