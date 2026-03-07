import { describe, expect, it } from 'vitest'
import {
  getExcludedAppMatch,
  getExcludedUrlMatch,
  getExcludedWindowTitleMatch,
  normalizeExcludedApps,
  normalizeWildcardPatterns,
} from './capture-exclusions'

describe('capture exclusions', () => {
  it('normalizes and deduplicates excluded apps', () => {
    expect(
      normalizeExcludedApps(['  KeePassXC.exe ', 'keepassxc', 'signal', 'Signal.app', '', '  ']),
    ).toEqual(['keepassxc', 'signal'])
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

  it('matches bundle id segment', () => {
    const excludedApps = new Set(normalizeExcludedApps(['chrome']))
    expect(
      getExcludedAppMatch(
        { processName: 'Google Chrome', bundleId: 'com.google.Chrome' },
        excludedApps,
      ),
    ).toBe('chrome')
  })

  it('normalizes and deduplicates wildcard patterns', () => {
    expect(normalizeWildcardPatterns(['  *github*  ', '*github*', '', '  '])).toEqual(['*github*'])
  })

  it('matches window title wildcard patterns', () => {
    const patterns = normalizeWildcardPatterns(['*incognito*', 'private ?indow*'])
    expect(
      getExcludedWindowTitleMatch(
        {
          title: 'New Incognito Tab - Google Chrome (Incognito)',
        },
        patterns,
      ),
    ).toBe('*incognito*')
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
})
