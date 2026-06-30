import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { InstalledApp } from '../../shared/types'
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
      expect(defaults.databaseExportDirectory).toBe('')
      expect(defaults.excludePrivateBrowsing).toBe(true)
      expect(defaults.excludedApps).toEqual([])
      expect(defaults.excludedUrlPatterns).toEqual([])
      expect(defaults.uploadDetailLevel).toBe('off')
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

    it('persists database export directory to disk', () => {
      // Path must be inside one of the safe roots (home/documents/desktop/userData)
      // so the path-traversal check accepts it. Use a real subdirectory of the
      // tmp dir we already create under os.tmpdir() — but the path-traversal
      // check rejects /tmp paths, so we use a directory inside the user's home.
      const safeDir = fs.mkdtempSync(path.join(os.homedir(), 'ml-export-test-'))
      try {
        const manager = new CaptureSettingsManager(configPath)
        manager.save({ databaseExportDirectory: safeDir })

        const reloaded = new CaptureSettingsManager(configPath)
        expect(reloaded.get().databaseExportDirectory).toBe(fs.realpathSync(safeDir))
      } finally {
        fs.rmSync(safeDir, { recursive: true, force: true })
      }
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
        excludedUrlPatterns: [' *://*.github.com/* ', '*://*.GITHUB.com/*', ''],
      })

      expect(manager.get().excludedUrlPatterns).toEqual(['*://*.github.com/*'])
    })

    it('migrates pre-v1 bare url patterns to contains-style on load', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({ excludedUrlPatterns: ['linear.app', '*keepme*'] }),
      )
      const manager = new CaptureSettingsManager(configPath)
      // Bare patterns from the substring era are wrapped to keep matching;
      // patterns that already contain wildcards are left untouched.
      expect(manager.get().excludedUrlPatterns).toEqual(['*linear.app*', '*keepme*'])
    })

    it('wraps pre-v1 patterns containing a literal ? so they keep matching', () => {
      // `?` was the old single-char wildcard; it is literal now. A pre-v1 pattern
      // with `?` but no `*` must still be wrapped — left bare it would be read as a
      // domain and silently stop matching.
      fs.writeFileSync(
        configPath,
        JSON.stringify({ excludedUrlPatterns: ['mychart?id', 'github.com/login?x'] }),
      )
      const manager = new CaptureSettingsManager(configPath)
      expect(manager.get().excludedUrlPatterns).toEqual(['*mychart?id*', '*github.com/login?x*'])
    })

    it('persists private browsing exclusion flag', () => {
      const manager = new CaptureSettingsManager(configPath)
      manager.save({ excludePrivateBrowsing: false })

      const reloaded = new CaptureSettingsManager(configPath)
      expect(reloaded.get().excludePrivateBrowsing).toBe(false)
    })

    it('persists uploadDetailLevel across reloads', () => {
      for (const level of ['off', 'summary', 'detailed'] as const) {
        const manager = new CaptureSettingsManager(configPath)
        manager.save({ uploadDetailLevel: level })
        const reloaded = new CaptureSettingsManager(configPath)
        expect(reloaded.get().uploadDetailLevel).toBe(level)
      }
    })

    it('preserves pre-existing summary/detailed values on load (backward compat)', () => {
      for (const level of ['summary', 'detailed'] as const) {
        fs.writeFileSync(configPath, JSON.stringify({ uploadDetailLevel: level }))
        const manager = new CaptureSettingsManager(configPath)
        expect(manager.get().uploadDetailLevel).toBe(level)
      }
    })

    it("fresh install (no config file) defaults uploadDetailLevel to 'off' for customer edition", () => {
      expect(fs.existsSync(configPath)).toBe(false)
      const manager = new CaptureSettingsManager({ configPath, edition: 'customer' })
      expect(manager.get().uploadDetailLevel).toBe('off')
    })

    it("fresh install (no config file) defaults uploadDetailLevel to 'detailed' for enterprise edition", () => {
      expect(fs.existsSync(configPath)).toBe(false)
      const manager = new CaptureSettingsManager({ configPath, edition: 'enterprise' })
      expect(manager.get().uploadDetailLevel).toBe('detailed')
    })

    it('respects a previously persisted off value on enterprise (does not reapply default)', () => {
      fs.writeFileSync(configPath, JSON.stringify({ uploadDetailLevel: 'off' }))
      const manager = new CaptureSettingsManager({ configPath, edition: 'enterprise' })
      expect(manager.get().uploadDetailLevel).toBe('off')
    })

    it('normalizes blank database export directories to disabled', () => {
      fs.writeFileSync(configPath, JSON.stringify({ databaseExportDirectory: '   ' }))
      const manager = new CaptureSettingsManager(configPath)
      expect(manager.get().databaseExportDirectory).toBe('')
    })

    it('drops databaseExportDirectory outside the safe roots', () => {
      const manager = new CaptureSettingsManager(configPath)
      manager.save({ databaseExportDirectory: '/tmp/evil-export' })
      expect(manager.get().databaseExportDirectory).toBe('')
    })

    it('drops databaseExportDirectory containing .. segments', () => {
      const manager = new CaptureSettingsManager(configPath)
      manager.save({ databaseExportDirectory: `${os.homedir()}/../etc/evil` })
      expect(manager.get().databaseExportDirectory).toBe('')
    })

    it('drops databaseExportDirectory containing .. with backslash separators', () => {
      // Windows treats both `/` and `\` as path separators. The previous
      // implementation split on `path.sep` only, which on Windows is `\` and
      // would miss `..` segments delimited by `/` (and on POSIX would miss
      // `\..\`). Verify the validator now catches `..` regardless of which
      // separator the input uses.
      const manager = new CaptureSettingsManager(configPath)
      manager.save({ databaseExportDirectory: `${os.homedir()}\\..\\etc\\evil` })
      expect(manager.get().databaseExportDirectory).toBe('')
    })

    it('drops non-absolute databaseExportDirectory paths', () => {
      const manager = new CaptureSettingsManager(configPath)
      manager.save({ databaseExportDirectory: 'relative/path' })
      expect(manager.get().databaseExportDirectory).toBe('')
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

  describe('per-vendor model memory', () => {
    it('restores a previously customized model when switching back to the vendor', () => {
      const manager = new CaptureSettingsManager(configPath)
      // Customize OpenRouter (the default active vendor).
      manager.save({ semanticSnapshotModel: 'google/gemini-2.5-flash-lite' })

      // Switch to Google — flat fields should now hold Google's defaults.
      manager.setActiveVendor('google')
      expect(manager.get().activeVendor).toBe('google')
      expect(manager.get().semanticSnapshotModel).not.toBe('google/gemini-2.5-flash-lite')

      // Switch back to OpenRouter — the customized snapshot model returns.
      manager.setActiveVendor('openrouter')
      expect(manager.get().activeVendor).toBe('openrouter')
      expect(manager.get().semanticSnapshotModel).toBe('google/gemini-2.5-flash-lite')
    })

    it('first switch to a vendor uses that vendor defaults', () => {
      const manager = new CaptureSettingsManager(configPath)
      manager.setActiveVendor('openai-compatible')
      const settings = manager.get()
      expect(settings.activeVendor).toBe('openai-compatible')
      // openai-compatible has no video preset, so pipeline locks to image.
      expect(settings.semanticPipelineMode).toBe('image')
      // openai-compatible ships no model defaults — slots stay empty until
      // the user picks (or legacy migration restores) a model id.
      expect(settings.semanticSnapshotModel).toBe('')
      expect(settings.patternDetectionModel).toBe('')
    })

    it('save() writes flat model picks into modelsByVendor[activeVendor]', () => {
      const manager = new CaptureSettingsManager(configPath)
      manager.save({ semanticVideoModel: 'google/gemini-2.5-flash' })
      const settings = manager.get()
      expect(settings.modelsByVendor.openrouter?.semanticVideoModel).toBe('google/gemini-2.5-flash')
    })

    it('persists per-vendor selections across instance reloads', () => {
      const m1 = new CaptureSettingsManager(configPath)
      m1.save({ semanticSnapshotModel: 'google/gemini-2.5-flash-lite' })
      m1.setActiveVendor('google')
      m1.save({ semanticSnapshotModel: 'gemini-2.5-flash' })

      const m2 = new CaptureSettingsManager(configPath)
      m2.setActiveVendor('openrouter')
      expect(m2.get().semanticSnapshotModel).toBe('google/gemini-2.5-flash-lite')
      m2.setActiveVendor('google')
      expect(m2.get().semanticSnapshotModel).toBe('gemini-2.5-flash')
    })

    it('legacy file without modelsByVendor is migrated on load', () => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          activeVendor: 'openrouter',
          semanticSnapshotModel: 'mistralai/mistral-small-3.2-24b-instruct',
          semanticPipelineMode: 'image',
        }),
      )
      const manager = new CaptureSettingsManager(configPath)
      const map = manager.get().modelsByVendor
      expect(map.openrouter).toBeDefined()
      expect(map.openrouter?.semanticSnapshotModel).toBe('mistralai/mistral-small-3.2-24b-instruct')
      expect(map.openrouter?.semanticPipelineMode).toBe('image')
    })

    it('switching vendors does not lose other vendor selections', () => {
      const manager = new CaptureSettingsManager(configPath)
      // Customize OpenRouter.
      manager.save({ patternDetectionModel: 'moonshotai/kimi-k2.5' })
      // Switch to Google, customize.
      manager.setActiveVendor('google')
      manager.save({ patternDetectionModel: 'gemini-2.5-pro' })
      // Switch to openai-compatible.
      manager.setActiveVendor('openai-compatible')

      const map = manager.get().modelsByVendor
      expect(map.openrouter?.patternDetectionModel).toBe('moonshotai/kimi-k2.5')
      expect(map.google?.patternDetectionModel).toBe('gemini-2.5-pro')
    })
  })

  describe('migrateAppTokens', () => {
    const installedApps: InstalledApp[] = [
      { displayName: 'MemoryLane', matchToken: 'com.memorylane.app' },
      { displayName: 'Slack', matchToken: 'com.tinyspeck.slackmacgap' },
    ]

    it('rewrites legacy tokens to bundle ids once, then no-ops on reload', async () => {
      fs.writeFileSync(configPath, JSON.stringify({ excludedApps: ['app', 'slackmacgap'] }))
      const manager = new CaptureSettingsManager(configPath)

      let calls = 0
      const getApps = async (): Promise<InstalledApp[]> => {
        calls++
        return installedApps
      }

      expect(await manager.migrateAppTokens(getApps)).toBe(true)
      expect(manager.get().excludedApps).toEqual([
        'com.memorylane.app',
        'com.tinyspeck.slackmacgap',
      ])
      expect(calls).toBe(1)

      // Version was stamped and persisted: a fresh instance does not migrate again.
      const reloaded = new CaptureSettingsManager(configPath)
      expect(await reloaded.migrateAppTokens(getApps)).toBe(false)
      expect(calls).toBe(1) // installed-apps list not enumerated a second time
      expect(reloaded.get().excludedApps).toEqual([
        'com.memorylane.app',
        'com.tinyspeck.slackmacgap',
      ])
    })

    it('stamps the version without enumerating apps when there are no exclusions', async () => {
      fs.writeFileSync(configPath, JSON.stringify({ typingDebounceMs: 3000 })) // legacy: no version
      const manager = new CaptureSettingsManager(configPath)

      let calls = 0
      expect(
        await manager.migrateAppTokens(async () => {
          calls++
          return installedApps
        }),
      ).toBe(false)
      expect(calls).toBe(0)
      expect(JSON.parse(fs.readFileSync(configPath, 'utf-8')).appMatchSchemaVersion).toBe(1)
    })

    it('does not stamp the version when no apps could be enumerated, so it retries', async () => {
      fs.writeFileSync(configPath, JSON.stringify({ excludedApps: ['app', 'slackmacgap'] }))
      const manager = new CaptureSettingsManager(configPath)

      // Enumeration returned empty (transient failure) — leave tokens and version untouched.
      expect(await manager.migrateAppTokens(async () => [])).toBe(false)
      expect(manager.get().excludedApps).toEqual(['app', 'slackmacgap'])
      expect(JSON.parse(fs.readFileSync(configPath, 'utf-8')).appMatchSchemaVersion ?? 0).toBe(0)

      // A later launch with a populated list completes the migration.
      expect(await manager.migrateAppTokens(async () => installedApps)).toBe(true)
      expect(manager.get().excludedApps).toEqual([
        'com.memorylane.app',
        'com.tinyspeck.slackmacgap',
      ])
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
