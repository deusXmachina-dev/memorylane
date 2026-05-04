export interface ParsedActivationCode {
  tenantToken: string
  email: string
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
  if (parts.length !== 2) {
    throw new Error('Activation code is malformed.')
  }

  const tenantToken = parts[0]
  const emailEncoded = parts[1]

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

  return { tenantToken, email }
}

const URLSAFE_BASE64_PATTERN = /^[A-Za-z0-9_-]+$/
