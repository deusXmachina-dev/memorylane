import { describe, expect, it } from 'vitest'
import { getLoginScreenMatch } from './capture-login-gate'

describe('capture login gate detection', () => {
  it('matches a login host prefix in a browser url', () => {
    const match = getLoginScreenMatch({
      processName: 'Google Chrome',
      title: 'Okta',
      url: 'https://login.okta.com/',
    })

    expect(match).toBe('host=login.')
  })

  it('matches a schemeless accounts host', () => {
    const match = getLoginScreenMatch({
      processName: 'Google Chrome',
      title: 'Google Accounts',
      url: 'accounts.google.com',
    })

    expect(match).toBe('host=accounts.')
  })

  it('matches an oauth path segment', () => {
    const match = getLoginScreenMatch({
      processName: 'Firefox',
      title: 'Authorize application',
      url: 'https://example.com/oauth/authorize',
    })

    expect(match).toBe('path=oauth')
  })

  it('matches a sign-in title phrase in a browser', () => {
    const match = getLoginScreenMatch({
      processName: 'Safari',
      title: 'Sign in to GitHub',
    })

    expect(match).toBe('title=sign in')
  })

  it('matches a password manager by bundle id outside a browser', () => {
    const match = getLoginScreenMatch({
      processName: '1Password',
      bundleId: 'com.1password.1password',
      title: 'Vault',
    })

    expect(match).toBe('com.1password.1password')
  })

  it('ignores login-like file names in non-browser apps', () => {
    const match = getLoginScreenMatch({
      processName: 'Code',
      title: 'login.tsx — Visual Studio Code',
    })

    expect(match).toBeNull()
  })

  it('ignores a password manager marketing site in a browser', () => {
    const match = getLoginScreenMatch({
      processName: 'Google Chrome',
      title: '1Password Pricing',
      url: 'https://1password.com/pricing',
    })

    expect(match).toBeNull()
  })

  it('ignores login mentioned inside a longer path segment', () => {
    const match = getLoginScreenMatch({
      processName: 'Google Chrome',
      title: 'Login best practices',
      url: 'https://example.com/blog/login-best-practices',
    })

    expect(match).toBeNull()
  })

  it('ignores a host that merely contains a prefix substring', () => {
    const match = getLoginScreenMatch({
      processName: 'Google Chrome',
      title: 'Menu',
      url: 'https://expresso.com/menu',
    })

    expect(match).toBeNull()
  })

  it('ignores a browser title about password requirements', () => {
    const match = getLoginScreenMatch({
      processName: 'Google Chrome',
      title: 'password requirements',
    })

    expect(match).toBeNull()
  })

  it('matches a sign-in title even when the url is clean', () => {
    const match = getLoginScreenMatch({
      processName: 'Google Chrome',
      title: 'Sign in to Acme',
      url: 'https://keycloak.acme.com/realms/acme/protocol/openid-connect/auth',
    })

    expect(match).toBe('title=sign in')
  })

  it('ignores a host whose first label merely starts with a marker', () => {
    const match = getLoginScreenMatch({
      processName: 'Google Chrome',
      title: 'Identity platform',
      url: 'https://identity.example.com/profile',
    })

    expect(match).toBeNull()
  })

  it('ignores a title phrase that spans a word boundary', () => {
    const match = getLoginScreenMatch({
      processName: 'Google Chrome',
      title: 'Assign inventory - Warehouse',
    })

    expect(match).toBeNull()
  })

  it('ignores a bare vendor docs url', () => {
    const match = getLoginScreenMatch({
      processName: 'Google Chrome',
      title: 'Okta docs',
      url: 'https://okta.com/docs',
    })

    expect(match).toBeNull()
  })
})
