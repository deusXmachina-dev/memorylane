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

  it('matches a log-in title phrase in a browser', () => {
    const match = getLoginScreenMatch({
      processName: 'Google Chrome',
      title: 'Log in | Slack',
    })

    expect(match).toBe('title=log in')
  })

  it('matches a bare login title segment', () => {
    const match = getLoginScreenMatch({
      processName: 'Google Chrome',
      title: 'Login • Acme',
    })

    expect(match).toBe('title=login')
  })

  it('matches a passkey prompt title', () => {
    const match = getLoginScreenMatch({
      processName: 'Google Chrome',
      title: 'Use a saved passkey for example.com',
    })

    expect(match).toBe('title=passkey')
  })

  it('matches a login path inside a redirect query parameter', () => {
    const match = getLoginScreenMatch({
      processName: 'Google Chrome',
      title: 'Slack',
      url: 'https://example-team.slack.com/?redir=%2Fssb%2Fsignin_redirect%3Fssb_vid%3Dredacted%26is_ssb_browser_signin%3D1',
    })

    expect(match).toBe('redirect=signin')
  })

  it('ignores a login search term in a non-redirect query parameter', () => {
    const match = getLoginScreenMatch({
      processName: 'Google Chrome',
      title: 'search results',
      url: 'https://example.com/search?q=login',
    })

    expect(match).toBeNull()
  })

  it('ignores a bare login word inside a longer title segment', () => {
    const match = getLoginScreenMatch({
      processName: 'Google Chrome',
      title: 'Login-screen capture gate by octocat · Pull Request #271 · example-org/example-repo',
    })

    expect(match).toBeNull()
  })

  it('ignores a mail thread that merely mentions a login', () => {
    const match = getLoginScreenMatch({
      processName: 'Google Chrome',
      title: 'Login for Linear - user@example.com - Example Mail',
    })

    expect(match).toBeNull()
  })

  it('ignores a passkey docs page', () => {
    const match = getLoginScreenMatch({
      processName: 'Google Chrome',
      title: 'Passkeys and security keys',
    })

    expect(match).toBeNull()
  })

  it('matches a password manager by process name when no bundle id is present', () => {
    const match = getLoginScreenMatch({
      processName: 'KeePassXC.exe',
    })

    expect(match).toBe('keepassxc')
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
      title: 'Contributors',
      url: 'https://authors.example.com/profile',
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
