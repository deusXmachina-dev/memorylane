import { describe, expect, it } from 'vitest'
import { getExcludedAppMatch, normalizeExcludedApps } from './capture-exclusions'

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
})
