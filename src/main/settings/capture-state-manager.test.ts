import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CaptureStateManager } from './capture-state-manager'

describe('CaptureStateManager', () => {
  let tmpDir: string
  let statePath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-capture-state-test-'))
    statePath = path.join(tmpDir, 'capture-state.json')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('defaults to capture disabled when no file exists', () => {
    const manager = new CaptureStateManager(statePath)
    expect(manager.isCaptureEnabled()).toBe(false)
  })

  it('persists capture enabled state to disk', () => {
    const manager = new CaptureStateManager(statePath)
    manager.setCaptureEnabled(true)

    expect(fs.existsSync(statePath)).toBe(true)
    expect(JSON.parse(fs.readFileSync(statePath, 'utf-8'))).toEqual({
      captureEnabled: true,
    })
  })

  it('loads persisted state in a new instance', () => {
    const manager = new CaptureStateManager(statePath)
    manager.setCaptureEnabled(true)

    const reloaded = new CaptureStateManager(statePath)
    expect(reloaded.isCaptureEnabled()).toBe(true)
  })

  it('falls back to disabled when the state file is corrupt', () => {
    fs.writeFileSync(statePath, 'not-json{{{')

    const manager = new CaptureStateManager(statePath)
    expect(manager.isCaptureEnabled()).toBe(false)
  })
})
