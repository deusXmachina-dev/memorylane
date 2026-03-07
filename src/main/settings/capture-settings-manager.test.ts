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
import { DEFAULT_CAPTURE_HOTKEY_ACCELERATOR } from '../hotkey-capture'

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
      expect(defaults.autoStartEnabled).toBe(true)
      expect(defaults.visualThreshold).toBe(VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT)
      expect(defaults.typingDebounceMs).toBe(INTERACTION_MONITOR_CONFIG.TYPING_DEBOUNCE_MS)
      expect(defaults.scrollDebounceMs).toBe(INTERACTION_MONITOR_CONFIG.SCROLL_DEBOUNCE_MS)
      expect(defaults.clickDebounceMs).toBe(INTERACTION_MONITOR_CONFIG.CLICK_DEBOUNCE_MS)
      expect(defaults.minActivityDurationMs).toBe(ACTIVITY_CONFIG.MIN_ACTIVITY_DURATION_MS)
      expect(defaults.maxActivityDurationMs).toBe(ACTIVITY_CONFIG.MAX_ACTIVITY_DURATION_MS)
      expect(defaults.maxScreenshotsForLlm).toBe(ACTIVITY_CONFIG.MAX_SCREENSHOTS_FOR_LLM)
      expect(defaults.semanticRequestTimeoutMs).toBe(ACTIVITY_CONFIG.SEMANTIC_REQUEST_TIMEOUT_MS)
      expect(defaults.semanticPipelineMode).toBe('auto')
      expect(defaults.captureHotkeyAccelerator).toBe(DEFAULT_CAPTURE_HOTKEY_ACCELERATOR)
      expect(defaults.excludePrivateBrowsing).toBe(true)
      expect(defaults.excludedApps).toEqual([])
      expect(defaults.excludedWindowTitlePatterns).toEqual([])
      expect(defaults.excludedUrlPatterns).toEqual([])
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
      manager.save({ autoStartEnabled: true, typingDebounceMs: 5000 })
      expect(fs.existsSync(configPath)).toBe(true)
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      expect(raw.autoStartEnabled).toBe(true)
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
      manager1.save({
        autoStartEnabled: true,
        typingDebounceMs: 7000,
        visualThreshold: 3,
        semanticPipelineMode: 'image',
        captureHotkeyAccelerator: 'CommandOrControl+Alt+P',
      })

      const manager2 = new CaptureSettingsManager(configPath)
      const settings = manager2.get()
      expect(settings.autoStartEnabled).toBe(true)
      expect(settings.typingDebounceMs).toBe(7000)
      expect(settings.visualThreshold).toBe(3)
      expect(settings.semanticPipelineMode).toBe('image')
      expect(settings.captureHotkeyAccelerator).toBe('CommandOrControl+Alt+P')
    })

    it('normalizes excluded app names', () => {
      const manager = new CaptureSettingsManager(configPath)
      manager.save({
        excludedApps: ['  KeePassXC.exe  ', 'keepassxc', 'Signal', 'signal.app', ''],
      })

      expect(manager.get().excludedApps).toEqual(['keepassxc', 'signal'])
    })

    it('normalizes wildcard exclusion patterns', () => {
      const manager = new CaptureSettingsManager(configPath)
      manager.save({
        excludedWindowTitlePatterns: [' *incognito* ', '*INCOGNITO*', ''],
        excludedUrlPatterns: [' *://*.github.com/* ', '*://*.GITHUB.com/*', ''],
      })

      expect(manager.get().excludedWindowTitlePatterns).toEqual(['*incognito*'])
      expect(manager.get().excludedUrlPatterns).toEqual(['*://*.github.com/*'])
    })

    it('persists private browsing exclusion flag', () => {
      const manager = new CaptureSettingsManager(configPath)
      manager.save({ excludePrivateBrowsing: false })

      const reloaded = new CaptureSettingsManager(configPath)
      expect(reloaded.get().excludePrivateBrowsing).toBe(false)
    })

    it('unknown keys in saved file are ignored (partial merge uses defaults)', () => {
      fs.writeFileSync(configPath, JSON.stringify({ unknownKey: 'oops', typingDebounceMs: 3000 }))
      const manager = new CaptureSettingsManager(configPath)
      const settings = manager.get()
      expect(settings.typingDebounceMs).toBe(3000)
      expect(settings.visualThreshold).toBe(VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT)
    })

    it('uses default maxScreenshotsForLlm when the saved value is missing', () => {
      fs.writeFileSync(configPath, JSON.stringify({ typingDebounceMs: 3000 }))
      const manager = new CaptureSettingsManager(configPath)
      const settings = manager.get()
      expect(settings.maxScreenshotsForLlm).toBe(ACTIVITY_CONFIG.MAX_SCREENSHOTS_FOR_LLM)
    })

    it('falls back to defaults when the file is corrupt JSON', () => {
      fs.writeFileSync(configPath, 'not-json{{{')
      const manager = new CaptureSettingsManager(configPath)
      expect(manager.get()).toEqual(manager.getDefaults())
    })

    it('normalizes an empty hotkey accelerator to the default', () => {
      fs.writeFileSync(configPath, JSON.stringify({ captureHotkeyAccelerator: '   ' }))
      const manager = new CaptureSettingsManager(configPath)
      expect(manager.get().captureHotkeyAccelerator).toBe(DEFAULT_CAPTURE_HOTKEY_ACCELERATOR)
    })

    it('reads legacy pauseHotkeyAccelerator values', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({ pauseHotkeyAccelerator: 'CommandOrControl+Alt+P' }),
      )
      const manager = new CaptureSettingsManager(configPath)
      expect(manager.get().captureHotkeyAccelerator).toBe('CommandOrControl+Alt+P')
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
      maxScreenshotsForLlm: ACTIVITY_CONFIG.MAX_SCREENSHOTS_FOR_LLM,
      semanticRequestTimeoutMs: ACTIVITY_CONFIG.SEMANTIC_REQUEST_TIMEOUT_MS,
    }

    afterEach(() => {
      VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT = original.visualThreshold
      INTERACTION_MONITOR_CONFIG.TYPING_DEBOUNCE_MS = original.typingDebounceMs
      INTERACTION_MONITOR_CONFIG.SCROLL_DEBOUNCE_MS = original.scrollDebounceMs
      INTERACTION_MONITOR_CONFIG.CLICK_DEBOUNCE_MS = original.clickDebounceMs
      ACTIVITY_CONFIG.MIN_ACTIVITY_DURATION_MS = original.minActivityDurationMs
      ACTIVITY_CONFIG.MAX_ACTIVITY_DURATION_MS = original.maxActivityDurationMs
      ACTIVITY_CONFIG.MAX_SCREENSHOTS_FOR_LLM = original.maxScreenshotsForLlm
      ACTIVITY_CONFIG.SEMANTIC_REQUEST_TIMEOUT_MS = original.semanticRequestTimeoutMs
    })

    it('mutates the shared constants to match saved settings', () => {
      const p = makeTmpPath()
      const manager = new CaptureSettingsManager(p)
      manager.save({ typingDebounceMs: 8000, visualThreshold: 3, maxScreenshotsForLlm: 4 })
      manager.applyToConstants()

      expect(INTERACTION_MONITOR_CONFIG.TYPING_DEBOUNCE_MS).toBe(8000)
      expect(VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT).toBe(3)
      expect(ACTIVITY_CONFIG.MAX_SCREENSHOTS_FOR_LLM).toBe(4)
    })

    it('applies semantic timeout to shared constants', () => {
      const p = makeTmpPath()
      const manager = new CaptureSettingsManager(p)
      manager.save({ semanticRequestTimeoutMs: 180_000 })
      manager.applyToConstants()

      expect(ACTIVITY_CONFIG.SEMANTIC_REQUEST_TIMEOUT_MS).toBe(180_000)
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
