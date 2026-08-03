import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import log from '@main/utils/logger'
import type {
  CaptureSettings,
  InstalledApp,
  SemanticPipelineMode,
  Vendor,
  VendorModelSelection,
} from '../../shared/types'
import { VENDORS } from '../../shared/types'
import type { AppEdition } from '../../shared/edition'
import { MODEL_DEFAULTS_VERSION, getVendorDefaults } from '../../shared/vendor-defaults'
import {
  isBundleIdToken,
  migrateExcludedAppTokens,
  normalizeExcludedApps,
  normalizeToken,
  normalizeWildcardPatterns,
} from '@main/capture/capture-exclusions'
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

/**
 * Resolve the list of safe roots a database export directory may live under.
 * Wrapped in try/catch because `electron.app.getPath` throws when called before
 * the app is ready, and `app` is unavailable entirely under
 * `ELECTRON_RUN_AS_NODE` (tests). Falls back to `os.homedir()` so the
 * containment check still has at least one root in those contexts.
 */
function getSafeRoots(): string[] {
  const roots: string[] = []
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as typeof import('electron')
    if (electron && electron.app && typeof electron.app.getPath === 'function') {
      for (const name of ['home', 'documents', 'desktop', 'userData'] as const) {
        try {
          roots.push(electron.app.getPath(name))
        } catch {
          // Some paths may be unavailable on some platforms; ignore.
        }
      }
    }
  } catch {
    // Electron unavailable — fall through to os.homedir() below.
  }
  if (roots.length === 0) {
    try {
      roots.push(os.homedir())
    } catch {
      // os.homedir() can throw in extreme contexts; we then fail closed.
    }
  }
  return roots
}

function isContainedIn(child: string, parent: string): boolean {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

type ExportDirResult = { ok: true; value: string } | { ok: false; reason: string }

/**
 * Single source of truth for databaseExportDirectory validation rules. Both
 * the forgiving load/merge path (`normalizeDatabaseExportDirectory`) and the
 * strict IPC entry point (`setDatabaseExportDirectory` on the manager) feed
 * through here.
 */
function validateExportDir(value: unknown): ExportDirResult {
  if (value === null || value === undefined) return { ok: true, value: '' }
  if (typeof value !== 'string') return { ok: false, reason: 'Path must be a string' }
  if (!/\S/.test(value)) return { ok: true, value: '' }
  if (!path.isAbsolute(value)) return { ok: false, reason: 'Path must be absolute' }
  // Split on both separators so a `..` segment is caught regardless of which
  // slash the input uses. On POSIX `path.sep` is `/`; on Windows it's `\` but
  // both `/` and `\` are valid separators, so a single-separator split would
  // miss `C:/foo/../bar`.
  if (value.split(/[\\/]/).includes('..')) return { ok: false, reason: 'Invalid path' }
  let resolved: string
  try {
    resolved = fs.realpathSync(value)
  } catch {
    // Path may not yet exist (e.g. user typed a path that hasn't been created);
    // fall back to path.resolve for the containment check.
    resolved = path.resolve(value)
  }
  const safeRoots = getSafeRoots()
  if (safeRoots.length === 0) {
    return { ok: false, reason: 'Safe roots unavailable (app not ready)' }
  }
  if (!safeRoots.some((root) => isContainedIn(resolved, root))) {
    return { ok: false, reason: 'Path is outside allowed locations' }
  }
  return { ok: true, value: resolved }
}

function normalizeDatabaseExportDirectory(value: string | null | undefined): string {
  const result = validateExportDir(value)
  if (result.ok) return result.value
  log.warn(`[CaptureSettings] Rejecting databaseExportDirectory (${result.reason}): ${value}`)
  return ''
}

const OPENROUTER_DEFAULTS = getVendorDefaults('openrouter')

function defaultUploadDetailLevel(edition: AppEdition): CaptureSettings['uploadDetailLevel'] {
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

// Bump when the meaning of stored excluded-app entries changes. v1: entries are
// full bundle ids (macOS) / exe names (Windows). `migrateAppTokens` upgrades
// pre-v1 last-segment/localized-name tokens to bundle ids on first launch.
const APP_MATCH_SCHEMA_VERSION = 1

const DEFAULTS: CaptureSettings = {
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
  semanticPipelineMode: 'auto',
  captureHotkeyAccelerator: DEFAULT_CAPTURE_HOTKEY_ACCELERATOR,
  databaseExportDirectory: '',
  excludePrivateBrowsing: true,
  excludeLoginScreens: true,
  excludedApps: [],
  excludedUrlPatterns: [],
  urlMatchSchemaVersion: URL_MATCH_SCHEMA_VERSION,
  appMatchSchemaVersion: APP_MATCH_SCHEMA_VERSION,
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
 * local models) keep the user's local pick. Pipeline mode is preserved.
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
    semanticPipelineMode: selection.semanticPipelineMode,
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

export interface CaptureSettingsManagerOptions {
  configPath?: string
  edition?: AppEdition
}

export class CaptureSettingsManager {
  private configPath: string
  private settings: CaptureSettings
  private defaults: CaptureSettings
  private modelDefaultsUpgraded = false

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
    // Persist the version stamp once so the override runs a single time, not on
    // every launch (mirrors migrateAppTokens stamping its schema version).
    if (this.modelDefaultsUpgraded) {
      this.save({})
    }
  }

  private load(): CaptureSettings {
    try {
      if (fs.existsSync(this.configPath)) {
        type StoredCaptureSettings = Partial<CaptureSettings> & {
          pauseHotkeyAccelerator?: string
          semanticRequestTimeoutMs?: number
          remoteModelConfigVersion?: number
        }
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf-8')) as StoredCaptureSettings
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
          }
          this.modelDefaultsUpgraded = true
          log.info(
            `[CaptureSettings] Model defaults v${data.modelDefaultsVersion ?? 0} → v${MODEL_DEFAULTS_VERSION}: overriding stored model picks with vendor defaults`,
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
          // Preserve the stored value (absent → 0) so the post-load, app-list-aware
          // migration (migrateAppTokens) can tell a pre-v1 file from a current one.
          appMatchSchemaVersion: data.appMatchSchemaVersion ?? 0,
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
          databaseExportDirectory: normalizeDatabaseExportDirectory(data.databaseExportDirectory),
          modelDefaultsVersion: MODEL_DEFAULTS_VERSION,
          activeVendor,
          semanticVideoModel: finalVideoModel,
          semanticSnapshotModel: finalSnapshotModel,
          patternDetectionModel: finalPatternModel,
          semanticPipelineMode,
          modelsByVendor: finalModelsByVendor,
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
   * Strict setter for databaseExportDirectory. Throws on invalid input so the
   * caller (IPC handler) can surface a clear error. Empty string clears.
   */
  public setDatabaseExportDirectory(value: unknown): void {
    const result = validateExportDir(value)
    if (!result.ok) {
      throw new Error(result.reason)
    }
    this.save({ databaseExportDirectory: result.value })
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

  /**
   * One-time, best-effort upgrade of pre-v1 excluded-app tokens (last segment /
   * localized name) to full bundle ids, using the installed-apps list to resolve
   * them. Version-gated, so it only runs — and only pays the app-enumeration cost
   * — on the first launch after upgrading. Returns whether tokens were rewritten.
   */
  public async migrateAppTokens(getInstalledApps: () => Promise<InstalledApp[]>): Promise<boolean> {
    if ((this.settings.appMatchSchemaVersion ?? 0) >= APP_MATCH_SCHEMA_VERSION) return false

    // Nothing to migrate — just stamp the version so we don't enumerate apps again.
    if (this.settings.excludedApps.length === 0) {
      this.save({ appMatchSchemaVersion: APP_MATCH_SCHEMA_VERSION })
      return false
    }

    let installedApps: InstalledApp[]
    try {
      installedApps = await getInstalledApps()
    } catch (error) {
      // Leave the version unstamped so we retry on a later launch.
      log.warn('[CaptureSettings] Skipping excluded-app migration (failed to list apps):', error)
      return false
    }

    // An empty list (a transient enumeration failure that didn't throw) can't
    // resolve anything; leave the version unstamped and retry on a later launch
    // rather than permanently abandoning the migration with tokens unchanged.
    if (installedApps.length === 0) {
      log.warn('[CaptureSettings] Skipping excluded-app migration (no installed apps enumerated)')
      return false
    }

    const before = this.settings.excludedApps
    const migrated = migrateExcludedAppTokens(before, installedApps)
    this.save({ excludedApps: migrated, appMatchSchemaVersion: APP_MATCH_SCHEMA_VERSION })

    // On macOS the matcher keys on bundle ids only, so a legacy short-name token
    // we couldn't resolve (ambiguous or unknown) will silently stop matching.
    // Surface it so a lapsed exclusion is diagnosable. A token is lapsed when it
    // was left unchanged, isn't already a reverse-DNS bundle id, and matches no
    // installed app's identity (the last check spares aliased ids like `whatsapp`).
    if (process.platform === 'darwin') {
      for (let i = 0; i < before.length; i++) {
        const token = normalizeToken(before[i])
        if (migrated[i] !== before[i] || isBundleIdToken(token)) continue
        if (installedApps.some((app) => app.matchToken === token)) continue
        log.warn(
          `[CaptureSettings] Excluded app "${before[i]}" could not be migrated to a bundle id and will no longer match`,
        )
      }
    }
    const changed = JSON.stringify(this.settings.excludedApps) !== JSON.stringify(before)
    if (changed) log.info('[CaptureSettings] Migrated excluded-app tokens to bundle ids')
    return changed
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
    ACTIVITY_CONFIG.SEMANTIC_REQUEST_TIMEOUT_MS = cs.activityRequestTimeoutMs
    PATTERN_DETECTION_CONFIG.REQUEST_TIMEOUT_MS = cs.taskMiningRequestTimeoutMs
  }
}
