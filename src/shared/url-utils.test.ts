import { describe, expect, it } from 'vitest'
import { isPrivateNetworkHost, isSameRegistrableDomain, registrableDomain } from './url-utils'

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
