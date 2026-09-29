import * as fs from 'fs'
import * as path from 'path'
import log from '@main/utils/logger'

interface ActivationState {
  activated: boolean
}

export class ActivationStateStore {
  private readonly statePath: string
  private state: ActivationState

  constructor(statePath?: string) {
    if (statePath !== undefined) {
      this.statePath = statePath
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require('electron') as typeof import('electron')
      this.statePath = path.join(app.getPath('userData'), 'activation-state.json')
    }
    this.state = this.load()
  }

  private load(): ActivationState {
    try {
      if (fs.existsSync(this.statePath)) {
        const data = JSON.parse(
          fs.readFileSync(this.statePath, 'utf-8'),
        ) as Partial<ActivationState>
        return { activated: data.activated === true }
      }
    } catch (error) {
      log.warn('[ActivationState] Failed to load state, using defaults:', error)
    }
    return { activated: false }
  }

  public isActivated(): boolean {
    return this.state.activated
  }

  public setActivated(activated: boolean): void {
    if (this.state.activated === activated) return
    const next: ActivationState = { activated }
    try {
      fs.writeFileSync(this.statePath, JSON.stringify(next, null, 2))
    } catch (error) {
      log.error('[ActivationState] Failed to save state:', error)
      return
    }
    this.state = next
    log.info(`[ActivationState] Activated set to ${activated}`)
  }
}
