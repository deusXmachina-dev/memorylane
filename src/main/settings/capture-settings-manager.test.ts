import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { CaptureSettingsManager } from './capture-settings-manager'
import {
  VISUAL_DETECTOR_CONFIG,
  INTERACTION_MONITOR_CONFIG,
  ACTIVITY_CONFIG,
} from '../../shared/constants'

function makeTmpPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ml-settings-test-')), 'settings.json')
}

describe('CaptureSettingsManager', () => {
  let configPath: string
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-settings-test-'))
    configPath = path.join(tmpDir, 'settings.json')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('defaults', () => {
    it('returns hardcoded defaults when no file exists', () => {
      const manager = new CaptureSettingsManager(configPath)
      expect(manager.get()).toEqual(manager.getDefaults())
    })

    it('defaults match the constants values', () => {
      const manager = new CaptureSettingsManager(configPath)
      const defaults = manager.getDefaults()
      expect(defaults.visualThreshold).toBe(VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT)
      expect(defaults.typingDebounceMs).toBe(INTERACTION_MONITOR_CONFIG.TYPING_DEBOUNCE_MS)
      expect(defaults.scrollDebounceMs).toBe(INTERACTION_MONITOR_CONFIG.SCROLL_DEBOUNCE_MS)
      expect(defaults.clickDebounceMs).toBe(INTERACTION_MONITOR_CONFIG.CLICK_DEBOUNCE_MS)
      expect(defaults.minActivityDurationMs).toBe(ACTIVITY_CONFIG.MIN_ACTIVITY_DURATION_MS)
      expect(defaults.maxActivityDurationMs).toBe(ACTIVITY_CONFIG.MAX_ACTIVITY_DURATION_MS)
      expect(defaults.maxScreenshotsPerActivity).toBe(ACTIVITY_CONFIG.MAX_SCREENSHOTS_PER_ACTIVITY)
    })

    it('get() returns a copy, not the internal reference', () => {
      const manager = new CaptureSettingsManager(configPath)
      const a = manager.get()
      const b = manager.get()
      expect(a).toEqual(b)
      expect(a).not.toBe(b)
    })
  })

  describe('save and load', () => {
    it('persists settings to disk', () => {
      const manager = new CaptureSettingsManager(configPath)
      manager.save({ typingDebounceMs: 5000 })
      expect(fs.existsSync(configPath)).toBe(true)
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      expect(raw.typingDebounceMs).toBe(5000)
    })

    it('merges partial saves with existing settings', () => {
      const manager = new CaptureSettingsManager(configPath)
      manager.save({ typingDebounceMs: 5000 })
      manager.save({ scrollDebounceMs: 1000 })
      const settings = manager.get()
      expect(settings.typingDebounceMs).toBe(5000)
      expect(settings.scrollDebounceMs).toBe(1000)
    })

    it('a new instance loads previously saved settings', () => {
      const manager1 = new CaptureSettingsManager(configPath)
      manager1.save({ typingDebounceMs: 7000, visualThreshold: 3 })

      const manager2 = new CaptureSettingsManager(configPath)
      const settings = manager2.get()
      expect(settings.typingDebounceMs).toBe(7000)
      expect(settings.visualThreshold).toBe(3)
    })

    it('unknown keys in saved file are ignored (partial merge uses defaults)', () => {
      fs.writeFileSync(configPath, JSON.stringify({ unknownKey: 'oops', typingDebounceMs: 3000 }))
      const manager = new CaptureSettingsManager(configPath)
      const settings = manager.get()
      expect(settings.typingDebounceMs).toBe(3000)
      expect(settings.visualThreshold).toBe(VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT)
    })

    it('falls back to defaults when the file is corrupt JSON', () => {
      fs.writeFileSync(configPath, 'not-json{{{')
      const manager = new CaptureSettingsManager(configPath)
      expect(manager.get()).toEqual(manager.getDefaults())
    })
  })

  describe('reset', () => {
    it('restores defaults in memory', () => {
      const manager = new CaptureSettingsManager(configPath)
      manager.save({ typingDebounceMs: 9000 })
      manager.reset()
      expect(manager.get().typingDebounceMs).toBe(INTERACTION_MONITOR_CONFIG.TYPING_DEBOUNCE_MS)
    })

    it('deletes the config file', () => {
      const manager = new CaptureSettingsManager(configPath)
      manager.save({ typingDebounceMs: 9000 })
      expect(fs.existsSync(configPath)).toBe(true)
      manager.reset()
      expect(fs.existsSync(configPath)).toBe(false)
    })

    it('is a no-op when no file exists', () => {
      const manager = new CaptureSettingsManager(configPath)
      expect(() => manager.reset()).not.toThrow()
    })
  })

  describe('applyToConstants', () => {
    const original = {
      visualThreshold: VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT,
      typingDebounceMs: INTERACTION_MONITOR_CONFIG.TYPING_DEBOUNCE_MS,
      scrollDebounceMs: INTERACTION_MONITOR_CONFIG.SCROLL_DEBOUNCE_MS,
      clickDebounceMs: INTERACTION_MONITOR_CONFIG.CLICK_DEBOUNCE_MS,
      minActivityDurationMs: ACTIVITY_CONFIG.MIN_ACTIVITY_DURATION_MS,
      maxActivityDurationMs: ACTIVITY_CONFIG.MAX_ACTIVITY_DURATION_MS,
      maxScreenshotsPerActivity: ACTIVITY_CONFIG.MAX_SCREENSHOTS_PER_ACTIVITY,
    }

    afterEach(() => {
      VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT = original.visualThreshold
      INTERACTION_MONITOR_CONFIG.TYPING_DEBOUNCE_MS = original.typingDebounceMs
      INTERACTION_MONITOR_CONFIG.SCROLL_DEBOUNCE_MS = original.scrollDebounceMs
      INTERACTION_MONITOR_CONFIG.CLICK_DEBOUNCE_MS = original.clickDebounceMs
      ACTIVITY_CONFIG.MIN_ACTIVITY_DURATION_MS = original.minActivityDurationMs
      ACTIVITY_CONFIG.MAX_ACTIVITY_DURATION_MS = original.maxActivityDurationMs
      ACTIVITY_CONFIG.MAX_SCREENSHOTS_PER_ACTIVITY = original.maxScreenshotsPerActivity
    })

    it('mutates the shared constants to match saved settings', () => {
      const p = makeTmpPath()
      const manager = new CaptureSettingsManager(p)
      manager.save({ typingDebounceMs: 8000, visualThreshold: 3 })
      manager.applyToConstants()

      expect(INTERACTION_MONITOR_CONFIG.TYPING_DEBOUNCE_MS).toBe(8000)
      expect(VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT).toBe(3)
    })

    it('after reset, applyToConstants restores constants to defaults', () => {
      const p = makeTmpPath()
      const manager = new CaptureSettingsManager(p)
      manager.save({ typingDebounceMs: 8000 })
      manager.applyToConstants()
      expect(INTERACTION_MONITOR_CONFIG.TYPING_DEBOUNCE_MS).toBe(8000)

      manager.reset()
      manager.applyToConstants()
      expect(INTERACTION_MONITOR_CONFIG.TYPING_DEBOUNCE_MS).toBe(original.typingDebounceMs)
    })
  })
})
