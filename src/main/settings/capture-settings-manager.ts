import * as fs from 'fs'
import * as path from 'path'
import log from '../logger'
import type { CaptureSettings } from '../../shared/types'
import {
  VISUAL_DETECTOR_CONFIG,
  INTERACTION_MONITOR_CONFIG,
  ACTIVITY_CONFIG,
} from '../../shared/constants'

const DEFAULTS: CaptureSettings = {
  autoStartEnabled: true,
  visualThreshold: VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT,
  typingDebounceMs: INTERACTION_MONITOR_CONFIG.TYPING_DEBOUNCE_MS,
  scrollDebounceMs: INTERACTION_MONITOR_CONFIG.SCROLL_DEBOUNCE_MS,
  clickDebounceMs: INTERACTION_MONITOR_CONFIG.CLICK_DEBOUNCE_MS,
  minActivityDurationMs: ACTIVITY_CONFIG.MIN_ACTIVITY_DURATION_MS,
  maxActivityDurationMs: ACTIVITY_CONFIG.MAX_ACTIVITY_DURATION_MS,
  maxScreenshotsForLlm: ACTIVITY_CONFIG.MAX_SCREENSHOTS_FOR_LLM,
  semanticRequestTimeoutMs: ACTIVITY_CONFIG.SEMANTIC_REQUEST_TIMEOUT_MS,
  semanticPipelineMode: 'auto',
}

export class CaptureSettingsManager {
  private configPath: string
  private settings: CaptureSettings

  constructor(configPath?: string) {
    if (configPath !== undefined) {
      this.configPath = configPath
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require('electron') as typeof import('electron')
      this.configPath = path.join(app.getPath('userData'), 'capture-settings.json')
    }
    this.settings = this.load()
  }

  private load(): CaptureSettings {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = JSON.parse(
          fs.readFileSync(this.configPath, 'utf-8'),
        ) as Partial<CaptureSettings>
        return {
          ...DEFAULTS,
          ...data,
          maxScreenshotsForLlm:
            typeof data.maxScreenshotsForLlm === 'number'
              ? data.maxScreenshotsForLlm
              : DEFAULTS.maxScreenshotsForLlm,
        }
      }
    } catch (error) {
      log.warn('[CaptureSettings] Failed to load settings, using defaults:', error)
    }
    return { ...DEFAULTS }
  }

  public get(): CaptureSettings {
    return { ...this.settings }
  }

  public save(partial: Partial<CaptureSettings>): void {
    this.settings = { ...this.settings, ...partial }
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.settings, null, 2))
      log.info('[CaptureSettings] Settings saved')
    } catch (error) {
      log.error('[CaptureSettings] Failed to save settings:', error)
      throw error
    }
  }

  public reset(): void {
    this.settings = { ...DEFAULTS }
    try {
      if (fs.existsSync(this.configPath)) {
        fs.unlinkSync(this.configPath)
      }
      log.info('[CaptureSettings] Settings reset to defaults')
    } catch (error) {
      log.error('[CaptureSettings] Failed to reset settings:', error)
      throw error
    }
  }

  public getDefaults(): CaptureSettings {
    return { ...DEFAULTS }
  }

  /**
   * Mutates the shared constants objects so the running app picks up persisted
   * settings without a restart. Safe to call multiple times (idempotent).
   */
  public applyToConstants(): void {
    const cs = this.settings
    VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT = cs.visualThreshold
    INTERACTION_MONITOR_CONFIG.TYPING_DEBOUNCE_MS = cs.typingDebounceMs
    INTERACTION_MONITOR_CONFIG.SCROLL_DEBOUNCE_MS = cs.scrollDebounceMs
    INTERACTION_MONITOR_CONFIG.CLICK_DEBOUNCE_MS = cs.clickDebounceMs
    ACTIVITY_CONFIG.MIN_ACTIVITY_DURATION_MS = cs.minActivityDurationMs
    ACTIVITY_CONFIG.MAX_ACTIVITY_DURATION_MS = cs.maxActivityDurationMs
    ACTIVITY_CONFIG.MAX_SCREENSHOTS_FOR_LLM = cs.maxScreenshotsForLlm
    ACTIVITY_CONFIG.SEMANTIC_REQUEST_TIMEOUT_MS = cs.semanticRequestTimeoutMs
  }
}
