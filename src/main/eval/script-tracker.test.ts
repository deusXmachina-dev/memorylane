import { describe, expect, it } from 'vitest'
import type { AppWatcherEvent } from '@main/recorder/app-watcher'
import type { RecordingScriptStep } from '@/shared/eval-review'
import { enteredStep } from './script-tracker'

const step = (expect: RecordingScriptStep['expect']): RecordingScriptStep => ({
  instruction: '',
  seconds: 10,
  expect,
})

const event = (partial: Partial<AppWatcherEvent>): AppWatcherEvent => ({
  type: 'app_change',
  timestamp: 1,
  ...partial,
})

describe('enteredStep', () => {
  it('matches an app step by name or bundle id', () => {
    const ghostty = step({ app: ['Ghostty'] })
    expect(enteredStep(ghostty, event({ app: 'Ghostty' }))).toBe(true)
    expect(enteredStep(ghostty, event({ app: 'ghostty', bundleId: 'com.mitchellh.ghostty' }))).toBe(
      true,
    )
    expect(enteredStep(ghostty, event({ app: 'Slack' }))).toBe(false)
  })

  it('matches a browser step on the host, ignoring a stale url', () => {
    const gmail = step({ app: ['browser'], tld: 'mail.google.com' })
    const chrome = { app: 'Google Chrome', bundleId: 'com.google.Chrome' }
    expect(
      enteredStep(
        gmail,
        event({ ...chrome, type: 'window_change', url: 'https://mail.google.com/mail/u/0/' }),
      ),
    ).toBe(true)
    expect(
      enteredStep(
        gmail,
        event({
          ...chrome,
          type: 'window_change',
          title: 'Inbox',
          url: 'https://calendar.google.com/',
        }),
      ),
    ).toBe(false)
    expect(enteredStep(gmail, event({ ...chrome, url: 'chrome://newtab/' }))).toBe(false)
    expect(enteredStep(gmail, event(chrome))).toBe(false)
  })

  it('matches a host with or without www', () => {
    const maps = step({ app: ['browser'], tld: 'www.google.com' })
    expect(enteredStep(maps, event({ app: 'chrome', url: 'https://google.com/maps' }))).toBe(true)
    expect(enteredStep(maps, event({ app: 'chrome', url: 'https://drive.google.com/' }))).toBe(
      false,
    )
  })

  it('matches a tld-less browser step on any browser', () => {
    const hop = step({ app: ['browser'], dropped: true })
    expect(enteredStep(hop, event({ app: 'Google Chrome', bundleId: 'com.google.Chrome' }))).toBe(
      true,
    )
    expect(enteredStep(hop, event({ app: 'TextEdit' }))).toBe(false)
  })

  it('ignores MemoryLane and non-focus events', () => {
    const chrome = step({ app: ['browser'] })
    expect(
      enteredStep(
        step({ app: ['MemoryLane'] }),
        event({ app: 'MemoryLane', bundleId: 'com.memorylane.app' }),
      ),
    ).toBe(false)
    expect(enteredStep(chrome, event({ type: 'ready', app: 'Google Chrome' }))).toBe(false)
    expect(enteredStep(chrome, event({ type: 'error', app: 'Google Chrome' }))).toBe(false)
  })
})
