import { isLikelyBrowser, normalize, normalizeProcessName } from './capture-anonymous-mode'

export interface LoginGateWindowContext {
  processName?: string
  bundleId?: string
  title?: string
  url?: string
}

const PASSWORD_MANAGER_BUNDLE_IDS = [
  'com.1password.1password',
  'com.agilebits.onepassword7',
  'com.bitwarden.desktop',
  'org.keepassxc.keepassxc',
  'com.lastpass.lastpass',
  'com.dashlane.dashlanephonefinal',
  'in.sinew.enpass-desktop',
]

const PASSWORD_MANAGER_PROCESS_NAMES = [
  '1password',
  'bitwarden',
  'keepassxc',
  'lastpass',
  'dashlane',
  'enpass',
]

const LOGIN_HOST_PREFIXES = ['login.', 'signin.', 'sso.', 'auth.', 'accounts.', 'idp.', 'mfa.']

const LOGIN_PATH_SEGMENTS = [
  'login',
  'signin',
  'sign-in',
  'oauth',
  'authorize',
  'saml',
  'sso',
  '2fa',
  'mfa',
  'otp',
  'reset-password',
  'forgot-password',
]

const REDIRECT_VALUE = /^(?:\/|https?:\/\/)/

const LOGIN_TITLE_PHRASES = [
  'sign in',
  'log in',
  'passkey',
  'authenticate',
  'two-factor',
  'verification code',
  'enter your password',
  'authentication required',
  'single sign-on',
]

const LOGIN_TITLE_SEGMENTS = ['login', 'signin']

const TITLE_SEPARATOR = /\s*[|•·—–]\s*|\s+-\s+/

function findPasswordManagerMarker(window: LoginGateWindowContext): string | null {
  const bundleId = normalize(window.bundleId)
  const processName = normalizeProcessName(window.processName)

  for (const marker of PASSWORD_MANAGER_BUNDLE_IDS) {
    if (bundleId === marker) {
      return marker
    }
  }

  for (const marker of PASSWORD_MANAGER_PROCESS_NAMES) {
    if (processName.includes(marker)) {
      return marker
    }
  }

  return null
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    try {
      return new URL(`https://${value}`)
    } catch {
      return null
    }
  }
}

function findLoginUrlMarker(url: string | undefined): string | null {
  const normalized = normalize(url)
  if (!normalized) return null

  const parsed = parseUrl(normalized)
  if (!parsed) return null

  const host = parsed.hostname
  const bareHost = host.startsWith('www.') ? host.slice(4) : host
  for (const prefix of LOGIN_HOST_PREFIXES) {
    if (host.startsWith(prefix) || bareHost.startsWith(prefix)) {
      return `host=${prefix}`
    }
  }

  const segments = parsed.pathname.split('/').filter(Boolean)
  for (const segment of segments) {
    if (LOGIN_PATH_SEGMENTS.includes(segment)) {
      return `path=${segment}`
    }
  }

  for (const [, value] of parsed.searchParams) {
    if (!REDIRECT_VALUE.test(value)) continue
    for (const token of value.split(/[^a-z0-9]+/)) {
      if (LOGIN_PATH_SEGMENTS.includes(token)) {
        return `redirect=${token}`
      }
    }
  }

  return null
}

function isWordCharacter(character: string | undefined): boolean {
  if (character === undefined) return false
  return character >= 'a' && character <= 'z' ? true : character >= '0' && character <= '9'
}

function includesPhrase(text: string, phrase: string): boolean {
  let index = text.indexOf(phrase)
  while (index !== -1) {
    if (!isWordCharacter(text[index - 1]) && !isWordCharacter(text[index + phrase.length])) {
      return true
    }
    index = text.indexOf(phrase, index + 1)
  }

  return false
}

function findLoginTitleMarker(title: string | undefined): string | null {
  const normalized = normalize(title)

  for (const phrase of LOGIN_TITLE_PHRASES) {
    if (includesPhrase(normalized, phrase)) {
      return `title=${phrase}`
    }
  }

  for (const part of normalized.split(TITLE_SEPARATOR)) {
    const segment = part.trim()
    if (LOGIN_TITLE_SEGMENTS.includes(segment)) {
      return `title=${segment}`
    }
  }

  return null
}

export function getLoginScreenMatch(window: LoginGateWindowContext | undefined): string | null {
  if (!window) return null

  const passwordManagerMarker = findPasswordManagerMarker(window)
  if (passwordManagerMarker !== null) return passwordManagerMarker

  if (!isLikelyBrowser(window)) return null

  const urlMarker = findLoginUrlMarker(window.url)
  if (urlMarker !== null) return urlMarker

  return findLoginTitleMarker(window.title)
}
