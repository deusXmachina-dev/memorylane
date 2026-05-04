import * as fs from 'fs'
import * as path from 'path'
import log from '../logger'
import type {
  CaptureSettings,
  SemanticPipelineMode,
  Vendor,
  VendorModelSelection,
} from '../../shared/types'
import { VENDORS } from '../../shared/types'
import type { AppEdition } from '../../shared/edition'
import { getVendorDefaults } from '../../shared/vendor-defaults'
import { normalizeExcludedApps, normalizeWildcardPatterns } from '../capture-exclusions'
import {
  VISUAL_DETECTOR_CONFIG,
  INTERACTION_MONITOR_CONFIG,
  ACTIVITY_CONFIG,
} from '../../shared/constants'
import {
  DEFAULT_CAPTURE_HOTKEY_ACCELERATOR,
  normalizeCaptureHotkeyAccelerator,
} from '../hotkey-capture'

function normalizeVendor(value: unknown): Vendor {
  return typeof value === 'string' && (VENDORS as readonly string[]).includes(value)
    ? (value as Vendor)
    : 'openrouter'
}

function normalizeDatabaseExportDirectory(value: string | null | undefined): string {
  return typeof value === 'string' && /\S/.test(value) ? value : ''
}

const OPENROUTER_DEFAULTS = getVendorDefaults('openrouter')

function defaultUploadDetailLevel(edition: AppEdition): CaptureSettings['uploadDetailLevel'] {
  // Enterprise installs opt into syncing by default — the backend is the
  // whole reason the edition exists. Customer installs default to off so
  // nothing leaves the device until the user explicitly turns it on.
  return edition === 'enterprise' ? 'detailed' : 'off'
}

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
  captureHotkeyAccelerator: DEFAULT_CAPTURE_HOTKEY_ACCELERATOR,
  databaseExportDirectory: '',
  excludePrivateBrowsing: true,
  excludedApps: [],
  excludedWindowTitlePatterns: [],
  excludedUrlPatterns: [],
  activeVendor: 'openrouter',
  semanticVideoModel: OPENROUTER_DEFAULTS.semanticVideoModel,
  semanticSnapshotModel: OPENROUTER_DEFAULTS.semanticSnapshotModel,
  patternDetectionModel: OPENROUTER_DEFAULTS.patternDetectionModel,
  modelsByVendor: {},
  patternDetectionEnabled: true,
  uploadDetailLevel: 'off',
}

const MIRRORED_KEYS = [
  'semanticVideoModel',
  'semanticSnapshotModel',
  'patternDetectionModel',
  'semanticPipelineMode',
] as const

function pickVendorSelection(s: {
  semanticVideoModel: string
  semanticSnapshotModel: string
  patternDetectionModel: string
  semanticPipelineMode: SemanticPipelineMode
}): VendorModelSelection {
  return {
    semanticVideoModel: s.semanticVideoModel,
    semanticSnapshotModel: s.semanticSnapshotModel,
    patternDetectionModel: s.patternDetectionModel,
    semanticPipelineMode: s.semanticPipelineMode,
  }
}

function normalizeVendorSelection(value: unknown): VendorModelSelection | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Partial<VendorModelSelection>
  const mode: SemanticPipelineMode =
    v.semanticPipelineMode === 'auto' ||
    v.semanticPipelineMode === 'video' ||
    v.semanticPipelineMode === 'image'
      ? v.semanticPipelineMode
      : 'auto'
  return {
    semanticVideoModel: typeof v.semanticVideoModel === 'string' ? v.semanticVideoModel : '',
    semanticSnapshotModel:
      typeof v.semanticSnapshotModel === 'string' ? v.semanticSnapshotModel : '',
    patternDetectionModel:
      typeof v.patternDetectionModel === 'string' ? v.patternDetectionModel : '',
    semanticPipelineMode: mode,
  }
}

function normalizeModelsByVendor(value: unknown): Partial<Record<Vendor, VendorModelSelection>> {
  const out: Partial<Record<Vendor, VendorModelSelection>> = {}
  if (!value || typeof value !== 'object') return out
  for (const vendor of VENDORS) {
    const entry = (value as Record<string, unknown>)[vendor]
    const normalized = normalizeVendorSelection(entry)
    if (normalized) out[vendor] = normalized
  }
  return out
}

export interface CaptureSettingsManagerOptions {
  configPath?: string
  edition?: AppEdition
}

export class CaptureSettingsManager {
  private configPath: string
  private settings: CaptureSettings
  private defaults: CaptureSettings

  constructor(options: CaptureSettingsManagerOptions | string = {}) {
    const opts: CaptureSettingsManagerOptions =
      typeof options === 'string' ? { configPath: options } : options
    if (opts.configPath !== undefined) {
      this.configPath = opts.configPath
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require('electron') as typeof import('electron')
      this.configPath = path.join(app.getPath('userData'), 'capture-settings.json')
    }
    this.defaults = {
      ...DEFAULTS,
      uploadDetailLevel: defaultUploadDetailLevel(opts.edition ?? 'customer'),
    }
    this.settings = this.load()
  }

  private load(): CaptureSettings {
    try {
      if (fs.existsSync(this.configPath)) {
        type StoredCaptureSettings = Partial<CaptureSettings> & {
          pauseHotkeyAccelerator?: string
        }
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf-8')) as StoredCaptureSettings
        const activeVendor = normalizeVendor(data.activeVendor)
        const vendorDefaults = getVendorDefaults(activeVendor)
        // Backfill empty model fields from current vendor defaults — handles
        // the case where the vendor was selected before its presets existed.
        const semanticVideoModel =
          typeof data.semanticVideoModel === 'string' && data.semanticVideoModel.length > 0
            ? data.semanticVideoModel
            : vendorDefaults.semanticVideoModel
        const semanticSnapshotModel =
          typeof data.semanticSnapshotModel === 'string' && data.semanticSnapshotModel.length > 0
            ? data.semanticSnapshotModel
            : vendorDefaults.semanticSnapshotModel
        const patternDetectionModel =
          typeof data.patternDetectionModel === 'string' && data.patternDetectionModel.length > 0
            ? data.patternDetectionModel
            : vendorDefaults.patternDetectionModel
        const semanticPipelineMode: SemanticPipelineMode =
          data.semanticPipelineMode === 'auto' ||
          data.semanticPipelineMode === 'video' ||
          data.semanticPipelineMode === 'image'
            ? data.semanticPipelineMode
            : this.defaults.semanticPipelineMode
        const modelsByVendor = normalizeModelsByVendor(data.modelsByVendor)
        // Legacy file (no per-vendor map): seed it with the active vendor's
        // current flat fields so the next switch can find them again.
        if (!modelsByVendor[activeVendor]) {
          modelsByVendor[activeVendor] = {
            semanticVideoModel,
            semanticSnapshotModel,
            patternDetectionModel,
            semanticPipelineMode,
          }
        }
        return {
          ...this.defaults,
          ...data,
          excludedApps: normalizeExcludedApps(data.excludedApps),
          excludedWindowTitlePatterns: normalizeWildcardPatterns(data.excludedWindowTitlePatterns),
          excludedUrlPatterns: normalizeWildcardPatterns(data.excludedUrlPatterns),
          maxScreenshotsForLlm:
            typeof data.maxScreenshotsForLlm === 'number'
              ? data.maxScreenshotsForLlm
              : this.defaults.maxScreenshotsForLlm,
          // Backward compatibility for settings persisted before capture-hotkey rename.
          captureHotkeyAccelerator: normalizeCaptureHotkeyAccelerator(
            data.captureHotkeyAccelerator ?? data.pauseHotkeyAccelerator,
          ),
          databaseExportDirectory: normalizeDatabaseExportDirectory(data.databaseExportDirectory),
          activeVendor,
          semanticVideoModel,
          semanticSnapshotModel,
          patternDetectionModel,
          semanticPipelineMode,
          modelsByVendor,
        }
      }
    } catch (error) {
      log.warn('[CaptureSettings] Failed to load settings, using defaults:', error)
    }
    return { ...this.defaults }
  }

  public get(): CaptureSettings {
    return { ...this.settings }
  }

  public save(partial: Partial<CaptureSettings>): void {
    const merged: CaptureSettings = {
      ...this.settings,
      ...partial,
      captureHotkeyAccelerator: normalizeCaptureHotkeyAccelerator(
        partial.captureHotkeyAccelerator ?? this.settings.captureHotkeyAccelerator,
      ),
      databaseExportDirectory: normalizeDatabaseExportDirectory(
        partial.databaseExportDirectory ?? this.settings.databaseExportDirectory,
      ),
      excludedApps: normalizeExcludedApps(partial.excludedApps ?? this.settings.excludedApps),
      excludedWindowTitlePatterns: normalizeWildcardPatterns(
        partial.excludedWindowTitlePatterns ?? this.settings.excludedWindowTitlePatterns,
      ),
      excludedUrlPatterns: normalizeWildcardPatterns(
        partial.excludedUrlPatterns ?? this.settings.excludedUrlPatterns,
      ),
    }
    // Mirror flat model picks into the per-vendor map for the active vendor,
    // unless the caller provided an explicit modelsByVendor (e.g. setActiveVendor
    // restoring a remembered selection). This keeps the map in sync with edits.
    if (
      partial.modelsByVendor === undefined &&
      MIRRORED_KEYS.some((k) => partial[k] !== undefined)
    ) {
      merged.modelsByVendor = {
        ...merged.modelsByVendor,
        [merged.activeVendor]: pickVendorSelection(merged),
      }
    }
    this.settings = merged
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.settings, null, 2))
      log.info('[CaptureSettings] Settings saved')
    } catch (error) {
      log.error('[CaptureSettings] Failed to save settings:', error)
      throw error
    }
  }

  /**
   * Switch the active vendor. Snapshots the current vendor's flat model fields
   * into the per-vendor map, then restores the target vendor's previously
   * remembered selection — falling back to vendor defaults on the first switch
   * to that vendor.
   */
  public setActiveVendor(vendor: Vendor): void {
    const current = this.settings
    const updatedMap: Partial<Record<Vendor, VendorModelSelection>> = {
      ...current.modelsByVendor,
      [current.activeVendor]: pickVendorSelection(current),
    }
    const remembered = updatedMap[vendor]
    let next: VendorModelSelection
    if (remembered) {
      next = remembered
    } else {
      const defaults = getVendorDefaults(vendor)
      next = {
        semanticVideoModel: defaults.semanticVideoModel,
        semanticSnapshotModel: defaults.semanticSnapshotModel,
        patternDetectionModel: defaults.patternDetectionModel,
        semanticPipelineMode: defaults.semanticVideoModel.length > 0 ? 'auto' : 'image',
      }
    }
    this.save({
      activeVendor: vendor,
      semanticVideoModel: next.semanticVideoModel,
      semanticSnapshotModel: next.semanticSnapshotModel,
      patternDetectionModel: next.patternDetectionModel,
      semanticPipelineMode: next.semanticPipelineMode,
      modelsByVendor: updatedMap,
    })
  }

  public reset(): void {
    this.settings = { ...this.defaults }
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
    return { ...this.defaults }
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
