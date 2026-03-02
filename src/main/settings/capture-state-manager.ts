import * as fs from 'fs'
import * as path from 'path'
import log from '../logger'

interface CaptureState {
  captureEnabled: boolean
}

const DEFAULTS: CaptureState = {
  captureEnabled: false,
}

export class CaptureStateManager {
  private readonly statePath: string
  private state: CaptureState

  constructor(statePath?: string) {
    if (statePath !== undefined) {
      this.statePath = statePath
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require('electron') as typeof import('electron')
      this.statePath = path.join(app.getPath('userData'), 'capture-state.json')
    }
    this.state = this.load()
  }

  private load(): CaptureState {
    try {
      if (fs.existsSync(this.statePath)) {
        const data = JSON.parse(fs.readFileSync(this.statePath, 'utf-8')) as Partial<CaptureState>
        return { ...DEFAULTS, ...data }
      }
    } catch (error) {
      log.warn('[CaptureState] Failed to load state, using defaults:', error)
    }
    return { ...DEFAULTS }
  }

  public isCaptureEnabled(): boolean {
    return this.state.captureEnabled
  }

  public setCaptureEnabled(enabled: boolean): void {
    this.state = { captureEnabled: enabled }
    try {
      fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2))
      log.info(`[CaptureState] Capture enabled set to ${enabled}`)
    } catch (error) {
      log.error('[CaptureState] Failed to save state:', error)
      throw error
    }
  }
}
