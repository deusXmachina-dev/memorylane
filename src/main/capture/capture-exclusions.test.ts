import { describe, expect, it } from 'vitest'
import {
  getExcludedAppMatch,
  getExcludedUrlMatch,
  normalizeExcludedApps,
  normalizeToken,
  normalizeWildcardPatterns,
  tokenFromBundleId,
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

  it('keeps a `.app` bundle-id tail but strips it from a bare app name', () => {
    expect(normalizeToken('com.memorylane.app')).toBe('com.memorylane.app')
    expect(normalizeToken('Signal.app')).toBe('signal')
  })

  it('derives the full bundle id as the match token', () => {
    expect(tokenFromBundleId('com.memorylane.app')).toBe('com.memorylane.app')
    expect(tokenFromBundleId('com.microsoft.Excel')).toBe('com.microsoft.excel')
  })

  it('matches a Windows app by its exe name (no bundle id)', () => {
    const excludedApps = new Set(normalizeExcludedApps(['keepassxc']))
    expect(getExcludedAppMatch({ processName: 'KeePassXC.exe' }, excludedApps)).toBe('keepassxc')
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

  it('matches a macOS app by its full bundle id only, never a sibling', () => {
    const excludedApps = new Set(normalizeExcludedApps(['com.microsoft.excel']))
    expect(
      getExcludedAppMatch(
        { processName: 'Microsoft Excel', bundleId: 'com.microsoft.Excel' },
        excludedApps,
      ),
    ).toBe('com.microsoft.excel')
    // Sibling app in the same suite is untouched.
    expect(
      getExcludedAppMatch(
        { processName: 'Microsoft Word', bundleId: 'com.microsoft.Word' },
        excludedApps,
      ),
    ).toBeNull()
    // A bare last-segment token no longer matches — bundle id is the identity.
    expect(
      getExcludedAppMatch(
        { processName: 'MemoryLane', bundleId: 'com.memorylane.app' },
        new Set(['app']),
      ),
    ).toBeNull()
    expect(
      getExcludedAppMatch(
        { processName: 'MemoryLane', bundleId: 'com.memorylane.app' },
        new Set(['com.memorylane.app']),
      ),
    ).toBe('com.memorylane.app')
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
