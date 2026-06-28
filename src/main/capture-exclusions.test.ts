import { describe, expect, it } from 'vitest'
import {
  getExcludedAppMatch,
  getExcludedUrlMatch,
  normalizeExcludedApps,
  normalizeWildcardPatterns,
} from './capture-exclusions'

describe('capture exclusions', () => {
  it('normalizes and deduplicates excluded apps', () => {
    expect(
      normalizeExcludedApps([
        '  KeePassXC.exe ',
        'keepassxc',
        'signal',
        'Signal.app',
        '',
        '  ',
        '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"',
        'Google Chrome',
        'Microsoft Edge',
      ]),
    ).toEqual(['keepassxc', 'signal', 'chrome', 'msedge'])
  })

  it('matches process name', () => {
    const excludedApps = new Set(normalizeExcludedApps(['keepassxc']))
    expect(
      getExcludedAppMatch(
        { processName: 'KeePassXC.exe', bundleId: 'org.keepassxc.keepassxc' },
        excludedApps,
      ),
    ).toBe('keepassxc')
  })

  it('matches windows process aliases and paths', () => {
    const excludedApps = new Set(
      normalizeExcludedApps([
        'Microsoft Edge',
        '"C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"',
      ]),
    )
    expect(
      getExcludedAppMatch({ processName: 'msedge.exe', title: 'Edge Window' }, excludedApps),
    ).toBe('msedge')
    expect(getExcludedAppMatch({ processName: 'brave', title: 'Brave Window' }, excludedApps)).toBe(
      'brave',
    )
  })

  it('matches bundle id segment', () => {
    const excludedApps = new Set(normalizeExcludedApps(['chrome']))
    expect(
      getExcludedAppMatch(
        { processName: 'Google Chrome', bundleId: 'com.google.Chrome' },
        excludedApps,
      ),
    ).toBe('chrome')
  })

  it('matches whatsapp bundle id alias', () => {
    const excludedApps = new Set(normalizeExcludedApps(['whatsapp']))
    expect(
      getExcludedAppMatch({ processName: 'WhatsApp', bundleId: 'whatsapp.root' }, excludedApps),
    ).toBe('whatsapp')
  })

  it('matches when user enters whatsapp.root directly', () => {
    const excludedApps = new Set(normalizeExcludedApps(['whatsapp.root']))
    expect(
      getExcludedAppMatch({ processName: 'WhatsApp', bundleId: 'whatsapp.root' }, excludedApps),
    ).toBe('whatsapp')
  })

  it('normalizes and deduplicates wildcard patterns', () => {
    expect(normalizeWildcardPatterns(['  *github*  ', '*github*', '', '  '])).toEqual(['*github*'])
  })

  // Entries reach the matcher already normalized (domain reduced to a bare host,
  // or a wildcard kept verbatim) — see normalizeUrlPattern.
  it('matches a domain and all its subdomains, on either platform form', () => {
    const patterns = ['linkedin.com']
    // macOS captures the canonical www host; Windows elides it. Both match.
    expect(getExcludedUrlMatch({ url: 'https://www.linkedin.com/feed/' }, patterns)).toBe(
      'linkedin.com',
    )
    expect(getExcludedUrlMatch({ url: 'https://linkedin.com/jobs' }, patterns)).toBe('linkedin.com')
    expect(getExcludedUrlMatch({ url: 'https://m.linkedin.com/' }, patterns)).toBe('linkedin.com')
  })

  it('does not match a look-alike or a mention in a query param', () => {
    const patterns = ['linkedin.com']
    expect(getExcludedUrlMatch({ url: 'https://google.com/?q=linkedin.com' }, patterns)).toBeNull()
    expect(getExcludedUrlMatch({ url: 'https://evil-linkedin.com/' }, patterns)).toBeNull()
    expect(getExcludedUrlMatch({ url: 'https://linkedin.com.evil.com/' }, patterns)).toBeNull()
  })

  it('matches a specific subdomain without blocking its siblings', () => {
    const patterns = ['mail.google.com']
    expect(getExcludedUrlMatch({ url: 'https://mail.google.com/inbox' }, patterns)).toBe(
      'mail.google.com',
    )
    expect(getExcludedUrlMatch({ url: 'https://docs.google.com/d/1' }, patterns)).toBeNull()
  })

  it('matches a wildcard as a substring anywhere in the url', () => {
    expect(
      getExcludedUrlMatch({ url: 'https://portal.example.com/mychart/visits' }, ['*mychart*']),
    ).toBe('*mychart*')
    expect(getExcludedUrlMatch({ url: 'https://example.com/health' }, ['*mychart*'])).toBeNull()
  })

  it('expands * in a wildcard to any run of characters', () => {
    expect(
      getExcludedUrlMatch({ url: 'https://github.com/foo/settings' }, ['github.com/*/settings']),
    ).toBe('github.com/*/settings')
  })

  it('treats ? in a wildcard as literal, not a single-char wildcard', () => {
    expect(getExcludedUrlMatch({ url: 'https://example.com/aXc' }, ['*a?c*'])).toBeNull()
    expect(getExcludedUrlMatch({ url: 'https://example.com/?a?c' }, ['*a?c*'])).toBe('*a?c*')
  })
})
