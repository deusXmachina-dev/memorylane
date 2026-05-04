export interface ParsedActivationCode {
  tenantToken: string
  email: string
  backendUrl: string | null
}

const TENANT_TOKEN_PREFIX = 'tt_'

export function parseActivationCode(rawCode: string): ParsedActivationCode {
  const code = rawCode.trim()
  if (code === '') {
    throw new Error('Activation code is required.')
  }
  if (!code.startsWith(TENANT_TOKEN_PREFIX)) {
    throw new Error('Activation code must start with `tt_`.')
  }

  const parts = code.split('.')
  if (parts.length < 2 || parts.length > 3) {
    throw new Error('Activation code is malformed.')
  }

  const tenantToken = parts[0]
  const emailEncoded = parts[1]
  const backendEncoded = parts[2]

  if (tenantToken === TENANT_TOKEN_PREFIX || emailEncoded === '') {
    throw new Error('Activation code is malformed.')
  }

  if (!URLSAFE_BASE64_PATTERN.test(emailEncoded)) {
    throw new Error('Activation code is malformed.')
  }

  const email = Buffer.from(emailEncoded, 'base64url').toString('utf8')
  if (email === '' || !email.includes('@')) {
    throw new Error('Activation code is malformed.')
  }

  let backendUrl: string | null = null
  if (backendEncoded !== undefined) {
    if (backendEncoded === '' || !URLSAFE_BASE64_PATTERN.test(backendEncoded)) {
      throw new Error('Activation code is malformed.')
    }
    const decoded = Buffer.from(backendEncoded, 'base64url').toString('utf8')
    backendUrl = normalizeBackendUrl(decoded)
    if (backendUrl === null) {
      throw new Error('Activation code is malformed.')
    }
  }

  return { tenantToken, email, backendUrl }
}

/**
 * Validate and normalize a decoded backend URL. Returns the normalized URL
 * (with a guaranteed trailing slash on the path so it composes with
 * `new URL(path, base)`), or `null` if the URL is unparseable, uses a
 * disallowed scheme, or otherwise fails validation.
 *
 * Shared between activation-code parsing and `EnterpriseLicenseConfig.load`
 * so persisted state goes through the same checks as fresh activation input.
 */
export function normalizeBackendUrl(decoded: string): string | null {
  if (decoded === '') return null

  let parsed: URL
  try {
    parsed = new URL(decoded)
  } catch {
    return null
  }

  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalhost)) {
    return null
  }

  return parsed.pathname.endsWith('/') ? parsed.toString() : `${parsed.toString()}/`
}

const URLSAFE_BASE64_PATTERN = /^[A-Za-z0-9_-]+$/
