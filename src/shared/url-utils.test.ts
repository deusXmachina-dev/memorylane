import { describe, expect, it } from 'vitest'
import {
  domainOf,
  isPrivateNetworkHost,
  isSameRegistrableDomain,
  normalizeUrlPattern,
  registrableDomain,
} from './url-utils'

describe('normalizeUrlPattern', () => {
  it('reduces a domain entry to its bare host (lowercased, www dropped)', () => {
    expect(normalizeUrlPattern('bank.com')).toBe('bank.com')
    expect(normalizeUrlPattern('  Bank.com  ')).toBe('bank.com')
    expect(normalizeUrlPattern('www.bank.com')).toBe('bank.com')
  })

  it('reduces a full URL to its host (scheme/path/query stripped)', () => {
    expect(normalizeUrlPattern('https://www.linkedin.com/feed/')).toBe('linkedin.com')
    expect(normalizeUrlPattern('http://intranet/portal')).toBe('intranet')
  })

  it('keeps wildcard entries verbatim (lowercased)', () => {
    expect(normalizeUrlPattern('*Bank*')).toBe('*bank*')
    expect(normalizeUrlPattern('github.com/*/settings')).toBe('github.com/*/settings')
  })

  it('returns empty/blank input unchanged', () => {
    expect(normalizeUrlPattern('')).toBe('')
    expect(normalizeUrlPattern('   ')).toBe('')
  })

  it('rejects a degenerate match-all wildcard to empty (would block everything)', () => {
    expect(normalizeUrlPattern('*')).toBe('')
    expect(normalizeUrlPattern('**')).toBe('')
    expect(normalizeUrlPattern('  *  ')).toBe('')
    // A wildcard with real literal content is kept.
    expect(normalizeUrlPattern('*bank*')).toBe('*bank*')
  })

  it('is idempotent', () => {
    expect(normalizeUrlPattern(normalizeUrlPattern('https://www.bank.com/x'))).toBe('bank.com')
    expect(normalizeUrlPattern(normalizeUrlPattern('*bank*'))).toBe('*bank*')
  })
})

describe('domainOf', () => {
  it('extracts and lowercases the host, dropping a leading www', () => {
    expect(domainOf('https://www.LinkedIn.com/feed')).toBe('linkedin.com')
    expect(domainOf('mail.google.com')).toBe('mail.google.com')
    expect(domainOf('localhost:3000')).toBe('localhost')
  })

  it('returns null when no host can be parsed', () => {
    expect(domainOf('')).toBeNull()
    expect(domainOf('   ')).toBeNull()
  })
})

describe('registrableDomain', () => {
  it('returns the last two labels for multi-label hosts', () => {
    expect(registrableDomain('api.openrouter.ai')).toBe('openrouter.ai')
    expect(registrableDomain('checkout.api.trymemorylane.com')).toBe('trymemorylane.com')
    expect(registrableDomain('googleapis.com')).toBe('googleapis.com')
  })

  it('lowercases the hostname', () => {
    expect(registrableDomain('API.OpenRouter.AI')).toBe('openrouter.ai')
  })

  it('returns single-label hosts unchanged', () => {
    expect(registrableDomain('localhost')).toBe('localhost')
  })

  it('returns IPv4 literals unchanged', () => {
    expect(registrableDomain('127.0.0.1')).toBe('127.0.0.1')
    expect(registrableDomain('10.0.0.1')).toBe('10.0.0.1')
  })

  it('returns IPv6 literals unchanged (with or without brackets)', () => {
    expect(registrableDomain('[::1]')).toBe('[::1]')
    expect(registrableDomain('::1')).toBe('::1')
  })
})

describe('isPrivateNetworkHost', () => {
  it('accepts RFC 1918 and link-local IPv4 ranges', () => {
    expect(isPrivateNetworkHost('10.0.0.92')).toBe(true)
    expect(isPrivateNetworkHost('10.255.255.255')).toBe(true)
    expect(isPrivateNetworkHost('192.168.1.50')).toBe(true)
    expect(isPrivateNetworkHost('169.254.1.1')).toBe(true)
  })

  it('respects the 172.16.0.0/12 boundaries', () => {
    expect(isPrivateNetworkHost('172.16.0.0')).toBe(true)
    expect(isPrivateNetworkHost('172.31.255.255')).toBe(true)
    expect(isPrivateNetworkHost('172.15.255.255')).toBe(false)
    expect(isPrivateNetworkHost('172.32.0.0')).toBe(false)
  })

  it('rejects public IPv4 addresses', () => {
    expect(isPrivateNetworkHost('8.8.8.8')).toBe(false)
    expect(isPrivateNetworkHost('1.1.1.1')).toBe(false)
    expect(isPrivateNetworkHost('0.0.0.0')).toBe(false)
  })

  it('rejects hostnames, IPv6, and malformed octets (fail-closed)', () => {
    expect(isPrivateNetworkHost('10.0.0.1.evil.com')).toBe(false)
    expect(isPrivateNetworkHost('localhost')).toBe(false)
    expect(isPrivateNetworkHost('[fc00::1]')).toBe(false)
    expect(isPrivateNetworkHost('10.0.0')).toBe(false)
    expect(isPrivateNetworkHost('10.0.0.256')).toBe(false)
    expect(isPrivateNetworkHost('10.0.0.1.1')).toBe(false)
  })
})

describe('isSameRegistrableDomain', () => {
  it('matches same registrable domain across subdomains', () => {
    expect(
      isSameRegistrableDomain(
        'https://checkout.trymemorylane.com/x',
        'https://api.trymemorylane.com/',
      ),
    ).toBe(true)
  })

  it('rejects different registrable domains', () => {
    expect(
      isSameRegistrableDomain('https://attacker.example/x', 'https://api.trymemorylane.com/'),
    ).toBe(false)
  })

  it('matches localhost in dev', () => {
    expect(isSameRegistrableDomain('http://localhost:8000/x', 'http://localhost:8000/')).toBe(true)
  })

  it('returns false on parse error', () => {
    expect(isSameRegistrableDomain('not a url', 'https://example.com/')).toBe(false)
    expect(isSameRegistrableDomain('https://example.com/', 'not a url')).toBe(false)
  })
})
