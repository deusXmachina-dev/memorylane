import { describe, expect, it } from 'vitest'
import { getAnonymousModeBrowserMatch } from './capture-anonymous-mode'

describe('capture anonymous mode detection', () => {
  it('matches private mode marker from browser title', () => {
    const match = getAnonymousModeBrowserMatch({
      processName: 'Google Chrome',
      title: 'New Incognito Tab - Google Chrome',
    })

    expect(match).toBe('incognito')
  })

  it('matches windows in private title variant with space', () => {
    const match = getAnonymousModeBrowserMatch({
      processName: 'msedge.exe',
      title: 'In Private window - Microsoft Edge',
    })

    expect(match).toBe('in private')
  })

  it('matches private mode marker from browser url', () => {
    const match = getAnonymousModeBrowserMatch({
      processName: 'Firefox',
      title: 'Mozilla Firefox',
      url: 'about:privatebrowsing',
    })

    expect(match).toBe('about:privatebrowsing')
  })

  it('matches private mode marker from edge private url', () => {
    const match = getAnonymousModeBrowserMatch({
      processName: 'msedge',
      title: 'Microsoft Edge',
      url: 'edge://inprivate',
    })

    expect(match).toBe('inprivate')
  })

  it('ignores non-browser apps', () => {
    const match = getAnonymousModeBrowserMatch({
      processName: 'Terminal',
      title: 'private window notes',
    })

    expect(match).toBeNull()
  })
})
