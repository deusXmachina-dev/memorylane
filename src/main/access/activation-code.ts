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
    backendUrl = decodeAndValidateBackendUrl(backendEncoded)
  }

  return { tenantToken, email, backendUrl }
}

function decodeAndValidateBackendUrl(encoded: string): string {
  const decoded = Buffer.from(encoded, 'base64url').toString('utf8')
  if (decoded === '') {
    throw new Error('Activation code is malformed.')
  }

  let parsed: URL
  try {
    parsed = new URL(decoded)
  } catch {
    throw new Error('Activation code is malformed.')
  }

  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalhost)) {
    throw new Error('Activation code is malformed.')
  }

  // Normalize trailing slash so it composes correctly with `new URL(path, base)`
  // in the access provider (see enterprise-access-provider.ts).
  return parsed.pathname.endsWith('/') ? parsed.toString() : `${parsed.toString()}/`
}

const URLSAFE_BASE64_PATTERN = /^[A-Za-z0-9_-]+$/
