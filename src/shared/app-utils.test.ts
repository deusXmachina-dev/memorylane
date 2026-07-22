import { describe, expect, it } from 'vitest'
import { activityAppIdentity, deriveSightingApps } from './app-utils'

describe('activityAppIdentity', () => {
  it('uses the host for web activities', () => {
    expect(activityAppIdentity({ appName: 'Google Chrome', tld: 'dashboard.stripe.com' })).toBe(
      'dashboard.stripe.com',
    )
  })

  it('strips a leading www.', () => {
    expect(activityAppIdentity({ appName: 'Google Chrome', tld: 'www.notion.so' })).toBe(
      'notion.so',
    )
  })

  it('falls back to the app name when there is no real host', () => {
    expect(activityAppIdentity({ appName: 'Ghostty', tld: null })).toBe('Ghostty')
    expect(activityAppIdentity({ appName: 'Google Chrome', tld: '' })).toBe('Google Chrome')
    expect(activityAppIdentity({ appName: 'Google Chrome', tld: 'newtab' })).toBe('Google Chrome')
  })
})

describe('deriveSightingApps', () => {
  it('dedupes apps in first-appearance order', () => {
    expect(
      deriveSightingApps([
        { appName: 'dashboard.stripe.com' },
        { appName: 'Ghostty' },
        { appName: 'dashboard.stripe.com' },
        { appName: 'mail.google.com' },
      ]),
    ).toEqual(['dashboard.stripe.com', 'Ghostty', 'mail.google.com'])
  })

  it('drops browser names when the run has another app', () => {
    expect(
      deriveSightingApps([{ appName: 'Google Chrome' }, { appName: 'app.signnow.com' }]),
    ).toEqual(['app.signnow.com'])
  })

  it('keeps the browser name when the run has nothing else', () => {
    expect(deriveSightingApps([{ appName: 'Google Chrome' }])).toEqual(['Google Chrome'])
  })

  it('returns an empty list for no activities', () => {
    expect(deriveSightingApps([])).toEqual([])
  })
})
