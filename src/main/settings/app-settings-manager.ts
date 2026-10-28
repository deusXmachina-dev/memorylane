import * as fs from 'fs'
import * as path from 'path'
import log from '@main/utils/logger'
import type {
  AppSettings,
  SemanticPipelineMode,
  Vendor,
  VendorModelSelection,
} from '../../shared/types'
import { VENDORS } from '../../shared/types'
import type { AppEdition } from '../../shared/edition'
import { MODEL_DEFAULTS_VERSION, getVendorDefaults } from '../../shared/vendor-defaults'
import { normalizeExcludedApps, normalizeWildcardPatterns } from '@main/capture/capture-exclusions'
import {
  VISUAL_DETECTOR_CONFIG,
  INTERACTION_MONITOR_CONFIG,
  ACTIVITY_CONFIG,
  PATTERN_DETECTION_CONFIG,
} from '../../shared/constants'
import {
  DEFAULT_CAPTURE_HOTKEY_ACCELERATOR,
  normalizeCaptureHotkeyAccelerator,
} from '@main/capture/hotkey-capture'

function normalizeVendor(value: unknown): Vendor {
  return typeof value === 'string' && (VENDORS as readonly string[]).includes(value)
    ? (value as Vendor)
    : 'openrouter'
}

const OPENROUTER_DEFAULTS = getVendorDefaults('openrouter')

function defaultUploadDetailLevel(edition: AppEdition): AppSettings['uploadDetailLevel'] {
  // Enterprise installs opt into syncing by default — the backend is the
  // whole reason the edition exists. Customer installs default to off so
  // nothing leaves the device until the user explicitly turns it on.
  return edition === 'enterprise' ? 'detailed' : 'off'
}

// Bump when the meaning of stored URL exclusion entries changes. Entries are now
// a domain (host match, subdomain-inclusive) or a `*…*` wildcard (substring).
// v1's one-time migration wraps pre-v1 bare patterns in `*…*` on first load so
// their old "contains" behavior carries over as a wildcard.
const URL_MATCH_SCHEMA_VERSION = 1

const LEGACY_VISUAL_THRESHOLD_DEFAULT = 8

const DEFAULTS: AppSettings = {
  autoStartEnabled: true,
  visualThreshold: VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT,
  typingDebounceMs: INTERACTION_MONITOR_CONFIG.TYPING_DEBOUNCE_MS,
  scrollDebounceMs: INTERACTION_MONITOR_CONFIG.SCROLL_DEBOUNCE_MS,
  clickDebounceMs: INTERACTION_MONITOR_CONFIG.CLICK_DEBOUNCE_MS,
  minActivityDurationMs: ACTIVITY_CONFIG.MIN_ACTIVITY_DURATION_MS,
  maxActivityDurationMs: ACTIVITY_CONFIG.MAX_ACTIVITY_DURATION_MS,
  maxScreenshotsForLlm: ACTIVITY_CONFIG.MAX_SCREENSHOTS_FOR_LLM,
  activityRequestTimeoutMs: ACTIVITY_CONFIG.SEMANTIC_REQUEST_TIMEOUT_MS,
  taskMiningRequestTimeoutMs: PATTERN_DETECTION_CONFIG.REQUEST_TIMEOUT_MS,
  semanticPipelineMode: OPENROUTER_DEFAULTS.semanticPipelineMode,
  captureHotkeyAccelerator: DEFAULT_CAPTURE_HOTKEY_ACCELERATOR,
  excludePrivateBrowsing: true,
  excludeLoginScreens: true,
  excludedApps: [],
  excludedUrlPatterns: [],
  urlMatchSchemaVersion: URL_MATCH_SCHEMA_VERSION,
  modelDefaultsVersion: MODEL_DEFAULTS_VERSION,
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

/**
 * Reset a vendor's remembered model slots to the current vendor defaults. Slots
 * whose vendor has no curated default (empty preset list, e.g. openai-compatible
 * local models) keep the user's local pick. An `auto` pipeline mode takes the vendor default; an explicit video/image pick is kept.
 */
function overrideWithVendorDefaults(
  selection: VendorModelSelection,
  vendor: Vendor,
): VendorModelSelection {
  const d = getVendorDefaults(vendor)
  return {
    semanticVideoModel: d.semanticVideoModel || selection.semanticVideoModel,
    semanticSnapshotModel: d.semanticSnapshotModel || selection.semanticSnapshotModel,
    patternDetectionModel: d.patternDetectionModel || selection.patternDetectionModel,
    semanticPipelineMode:
      selection.semanticPipelineMode === 'auto'
        ? d.semanticPipelineMode
        : selection.semanticPipelineMode,
  }
}

function positiveMsOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
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

export interface AppSettingsManagerOptions {
  configPath?: string
  edition?: AppEdition
}

export type AppSettingsListener = (next: AppSettings, previous: AppSettings) => void

export class AppSettingsManager {
  private configPath: string
  private settings: AppSettings
  private defaults: AppSettings
  private modelDefaultsUpgraded = false
  private readonly listeners = new Set<AppSettingsListener>()

  constructor(options: AppSettingsManagerOptions | string = {}) {
    const opts: AppSettingsManagerOptions =
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
    // Persist the version stamp once so the override runs a single time.
    if (this.modelDefaultsUpgraded) {
      this.save({})
    }
  }

  private load(): AppSettings {
    try {
      if (fs.existsSync(this.configPath)) {
        type StoredAppSettings = Partial<AppSettings> & {
          pauseHotkeyAccelerator?: string
          semanticRequestTimeoutMs?: number
          remoteModelConfigVersion?: number
        }
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf-8')) as StoredAppSettings
        delete data.remoteModelConfigVersion
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
        // Version bump: overwrite every remembered vendor's picks with the
        // current defaults and re-derive the active vendor's flat fields. See
        // MODEL_DEFAULTS_VERSION for why this is authoritative.
        let finalVideoModel = semanticVideoModel
        let finalSnapshotModel = semanticSnapshotModel
        let finalPatternModel = patternDetectionModel
        let finalPipelineMode = semanticPipelineMode
        let finalVisualThreshold =
          typeof data.visualThreshold === 'number'
            ? data.visualThreshold
            : this.defaults.visualThreshold
        let finalModelsByVendor = modelsByVendor
        if ((data.modelDefaultsVersion ?? 0) < MODEL_DEFAULTS_VERSION) {
          finalModelsByVendor = { ...modelsByVendor }
          for (const vendor of VENDORS) {
            const entry = finalModelsByVendor[vendor]
            if (entry) finalModelsByVendor[vendor] = overrideWithVendorDefaults(entry, vendor)
          }
          const active = finalModelsByVendor[activeVendor]
          if (active) {
            finalVideoModel = active.semanticVideoModel
            finalSnapshotModel = active.semanticSnapshotModel
            finalPatternModel = active.patternDetectionModel
            finalPipelineMode = active.semanticPipelineMode
          }
          if (finalVisualThreshold === LEGACY_VISUAL_THRESHOLD_DEFAULT)
            finalVisualThreshold = this.defaults.visualThreshold
          this.modelDefaultsUpgraded = true
          log.info(
            `[AppSettings] Model defaults v${data.modelDefaultsVersion ?? 0} → v${MODEL_DEFAULTS_VERSION}: overriding stored model picks with vendor defaults`,
          )
        }
        // Migrate pre-v1 URL patterns (substring era): wrap patterns without a
        // `*` in `*…*` so they keep contains behavior as a wildcard. Only `*` is a
        // wildcard now, so a pre-v1 `?` (the old single-char wildcard) must also be
        // wrapped — left bare it would be reinterpreted as a domain and stop
        // matching. Post-v1 entries are interpreted as a domain or wildcard as-is.
        const loadedUrlPatterns = normalizeWildcardPatterns(data.excludedUrlPatterns)
        const excludedUrlPatterns =
          (data.urlMatchSchemaVersion ?? 0) < URL_MATCH_SCHEMA_VERSION
            ? loadedUrlPatterns.map((p) => (p.includes('*') ? p : `*${p}*`))
            : loadedUrlPatterns
        return {
          ...this.defaults,
          ...data,
          excludedApps: normalizeExcludedApps(data.excludedApps),
          excludedUrlPatterns,
          urlMatchSchemaVersion: URL_MATCH_SCHEMA_VERSION,
          maxScreenshotsForLlm:
            typeof data.maxScreenshotsForLlm === 'number'
              ? data.maxScreenshotsForLlm
              : this.defaults.maxScreenshotsForLlm,
          // Backward compatibility for settings persisted before capture-hotkey rename.
          captureHotkeyAccelerator: normalizeCaptureHotkeyAccelerator(
            data.captureHotkeyAccelerator ?? data.pauseHotkeyAccelerator,
          ),
          // Backward compatibility for settings persisted before the activity-timeout rename.
          activityRequestTimeoutMs: positiveMsOrDefault(
            data.activityRequestTimeoutMs ?? data.semanticRequestTimeoutMs,
            this.defaults.activityRequestTimeoutMs,
          ),
          taskMiningRequestTimeoutMs: positiveMsOrDefault(
            data.taskMiningRequestTimeoutMs,
            this.defaults.taskMiningRequestTimeoutMs,
          ),
          modelDefaultsVersion: MODEL_DEFAULTS_VERSION,
          activeVendor,
          semanticVideoModel: finalVideoModel,
          semanticSnapshotModel: finalSnapshotModel,
          patternDetectionModel: finalPatternModel,
          semanticPipelineMode: finalPipelineMode,
          visualThreshold: finalVisualThreshold,
          modelsByVendor: finalModelsByVendor,
        }
      }
    } catch (error) {
      log.warn('[AppSettings] Failed to load settings, using defaults:', error)
    }
    return { ...this.defaults }
  }

  public get(): AppSettings {
    return { ...this.settings }
  }

  public onChange(listener: AppSettingsListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(previous: AppSettings): void {
    for (const listener of this.listeners) listener(this.get(), previous)
  }

  public save(partial: Partial<AppSettings>): void {
    const merged: AppSettings = {
      ...this.settings,
      ...partial,
      captureHotkeyAccelerator: normalizeCaptureHotkeyAccelerator(
        partial.captureHotkeyAccelerator ?? this.settings.captureHotkeyAccelerator,
      ),
      excludedApps: normalizeExcludedApps(partial.excludedApps ?? this.settings.excludedApps),
      excludedUrlPatterns: normalizeWildcardPatterns(
        partial.excludedUrlPatterns ?? this.settings.excludedUrlPatterns,
      ),
      activityRequestTimeoutMs: positiveMsOrDefault(
        partial.activityRequestTimeoutMs ?? this.settings.activityRequestTimeoutMs,
        this.defaults.activityRequestTimeoutMs,
      ),
      taskMiningRequestTimeoutMs: positiveMsOrDefault(
        partial.taskMiningRequestTimeoutMs ?? this.settings.taskMiningRequestTimeoutMs,
        this.defaults.taskMiningRequestTimeoutMs,
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
    const previous = this.settings
    this.settings = merged
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.settings, null, 2))
      log.info('[AppSettings] Settings saved')
    } catch (error) {
      log.error('[AppSettings] Failed to save settings:', error)
      throw error
    }
    this.notify(previous)
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
        semanticPipelineMode: defaults.semanticPipelineMode,
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
    const previous = this.settings
    this.settings = { ...this.defaults }
    try {
      if (fs.existsSync(this.configPath)) {
        fs.unlinkSync(this.configPath)
      }
      log.info('[AppSettings] Settings reset to defaults')
    } catch (error) {
      log.error('[AppSettings] Failed to reset settings:', error)
      throw error
    }
    this.notify(previous)
  }

  public getDefaults(): AppSettings {
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
    ACTIVITY_CONFIG.SEMANTIC_REQUEST_TIMEOUT_MS = cs.activityRequestTimeoutMs
    PATTERN_DETECTION_CONFIG.REQUEST_TIMEOUT_MS = cs.taskMiningRequestTimeoutMs
  }
}
