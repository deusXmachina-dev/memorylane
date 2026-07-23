import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LAUNCHD_MANAGED_ARG } from './launchd-mac'

// launchd-mac.ts duplicates the label, plist path and marker arg that the pkg
// postinstall script writes; this pins the two files together.
describe('launchd-mac / pkg postinstall contract', () => {
  const postinstall = readFileSync(
    path.join(process.cwd(), 'assets', 'pkg-scripts', 'postinstall'),
    'utf8',
  )

  it('plist passes the launchd marker arg', () => {
    expect(postinstall).toContain(`<string>${LAUNCHD_MANAGED_ARG}</string>`)
  })

  it('label and plist path match the module constants', () => {
    expect(postinstall).toContain('LABEL="com.memorylane.enterprise.launcher"')
    expect(postinstall).toContain('PLIST="/Library/LaunchAgents/$LABEL.plist"')
  })

  it('keeps the app alive unconditionally (tray Quit holds via bootout)', () => {
    expect(postinstall).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/)
  })
})
