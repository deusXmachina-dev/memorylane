import { describe, expect, it } from 'vitest'
import { isSameRegistrableDomain, registrableDomain } from './url-utils'

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
