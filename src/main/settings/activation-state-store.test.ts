import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActivationStateStore } from './activation-state-store'

describe('ActivationStateStore', () => {
  let dir: string
  let statePath: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activation-state-'))
    statePath = path.join(dir, 'activation-state.json')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('defaults to not activated', () => {
    expect(new ActivationStateStore(statePath).isActivated()).toBe(false)
  })

  it('persists the verdict across instances', () => {
    new ActivationStateStore(statePath).setActivated(true)
    expect(new ActivationStateStore(statePath).isActivated()).toBe(true)

    new ActivationStateStore(statePath).setActivated(false)
    expect(new ActivationStateStore(statePath).isActivated()).toBe(false)
  })

  it('keeps retrying after a failed write', () => {
    const nested = path.join(dir, 'missing', 'activation-state.json')
    const store = new ActivationStateStore(nested)

    store.setActivated(true)
    expect(store.isActivated()).toBe(false)

    fs.mkdirSync(path.dirname(nested))
    store.setActivated(true)
    expect(store.isActivated()).toBe(true)
    expect(new ActivationStateStore(nested).isActivated()).toBe(true)
  })

  it('treats a corrupt file as not activated', () => {
    fs.writeFileSync(statePath, '{not json')
    expect(new ActivationStateStore(statePath).isActivated()).toBe(false)
  })
})
