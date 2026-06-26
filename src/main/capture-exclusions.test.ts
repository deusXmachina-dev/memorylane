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

  it('matches url wildcard patterns', () => {
    const patterns = normalizeWildcardPatterns(['*://*.github.com/*'])
    expect(
      getExcludedUrlMatch(
        {
          url: 'https://deusXmachina-dev.github.com/memorylane',
        },
        patterns,
      ),
    ).toBe('*://*.github.com/*')
  })

  it('matches a url pattern as a prefix of the full url', () => {
    const patterns = normalizeWildcardPatterns(['https://portal.example.com'])
    expect(
      getExcludedUrlMatch({ url: 'https://portal.example.com/mychart/visits' }, patterns),
    ).toBe('https://portal.example.com')
  })

  it('does not match a plain pattern that only appears mid-url', () => {
    const patterns = normalizeWildcardPatterns(['mychart', 'bank.com'])
    expect(
      getExcludedUrlMatch({ url: 'https://portal.example.com/mychart/visits' }, patterns),
    ).toBeNull()
  })

  it('matches anywhere only with an explicit wildcard', () => {
    const patterns = normalizeWildcardPatterns(['*mychart*'])
    expect(
      getExcludedUrlMatch({ url: 'https://portal.example.com/mychart/visits' }, patterns),
    ).toBe('*mychart*')
  })

  it('does not suppress a different site that mentions the domain in a query param', () => {
    const patterns = normalizeWildcardPatterns(['https://linear.app'])
    expect(getExcludedUrlMatch({ url: 'https://google.com/?q=linear.app' }, patterns)).toBeNull()
    expect(getExcludedUrlMatch({ url: 'https://linear.app/issue/123' }, patterns)).toBe(
      'https://linear.app',
    )
  })
})
