/**
 * Main application window for MemoryLane
 *
 * Provides a visible control surface alongside the system tray.
 * Singleton window that hides on close instead of destroying.
 */

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  IpcMainInvokeEvent,
  nativeTheme,
  shell,
} from 'electron'
import path from 'node:path'
import { syncAutoStartSetting } from '../auto-start'
import { DEFAULT_EDITION, type AppEditionConfig } from '../../shared/edition'
import log from '../logger'
import { updateTrayMenu } from './tray'
import { exportDatabaseZip } from './database-export'
import { integrations } from '../integrations'
import { listInstalledApps } from '../apps/installed-apps'
import type { VendorCredentialsManager } from '../settings/vendor-credentials-manager'
import { VENDORS } from '../../shared/types'
import { VENDOR_PRESETS, buildModelChain, getVendorDefaults } from '../../shared/vendor-defaults'
import { applyVendorSwitch } from './vendor-switch'
import type { AccessProvider } from '../access'
import type {
  AccessState,
  ConsentOutcome,
  LlmHealthStatus,
  MainWindowStatus,
  MainWindowStats,
  CaptureSettings,
  McpRegistrationStatus,
  ObservationState,
  SemanticPipelineMode,
  SubscriptionPlan,
  Vendor,
  VendorCredentials,
  VendorStatus,
} from '../../shared/types'
import type { CaptureSettingsManager } from '../settings/capture-settings-manager'
import type { StorageService } from '../storage'
import type { UsageTracker } from '../services/usage-tracker'

interface SemanticService {
  updatePipelinePreference(preference: SemanticPipelineMode): void
  updateRequestTimeoutMs(timeoutMs: number): void
  updateModels(videoModels: string[], snapshotModels: string[]): void
  getLlmHealthStatus(): LlmHealthStatus
  testConnection(): Promise<void>
}

interface InferenceProviderLike {
  notifyConfigChanged(): void
}

interface PatternDetectorService {
  updateModel(model: string): void
  setEnabled(enabled: boolean): void
}

interface MainWindowDependencies {
  editionConfig: AppEditionConfig
  capture: {
    isCapturingNow: () => boolean
    requestStartCapture: () => void
    requestStopCapture: () => void
    forceClose: () => Promise<void>
    updateActivityWindowConfig: (input: {
      minActivityDurationMs: number
      maxActivityDurationMs: number
    }) => void
  }
  storage: StorageService
  usageTracker: UsageTracker
  vendorCredentials: VendorCredentialsManager
  inferenceProvider: InferenceProviderLike
  semanticService: SemanticService
  accessProvider: AccessProvider
  captureSettingsManager: CaptureSettingsManager
  patternDetector?: PatternDetectorService
  getCaptureHotkeyLabel: () => string
  reconfigureCaptureHotkey: (accelerator: string) => { success: boolean; error?: string }
  updateExclusions: (exclusions: {
    apps: string[]
    windowTitlePatterns: string[]
    urlPatterns: string[]
    excludePrivateBrowsing: boolean
  }) => void
  databaseExportSync: {
    onSettingsChanged: () => Promise<void>
  }
  databaseUploadSync?: {
    triggerUpload: () => Promise<{ success: boolean; error?: string }>
  }
  observation: {
    start: (durationMs: number) => ObservationState
    stop: (reason: 'user' | 'timer') => ObservationState
    getState: () => ObservationState
  }
}

let mainWindow: BrowserWindow | null = null
let deps: MainWindowDependencies | null = null
let isQuitting = false

app.on('before-quit', () => {
  isQuitting = true
})

/**
 * In managed mode the renderer only exposes the vendor's preset grid, so a
 * non-preset model id lingering in the remembered selection is stale and
 * unreachable from the UI. Reset such slots to the vendor's preset default.
 * Returns true if any field was rewritten.
 */
function reconcileManagedModelSelections(
  captureSettings: CaptureSettingsManager,
  vendor: Vendor,
): boolean {
  const presets = VENDOR_PRESETS[vendor]
  const settings = captureSettings.get()
  const defaults = getVendorDefaults(vendor)
  const updates: Partial<{
    semanticVideoModel: string
    semanticSnapshotModel: string
    patternDetectionModel: string
  }> = {}
  const isValid = (id: string, list: { id: string }[]): boolean =>
    list.length === 0 || list.some((p) => p.id === id)
  if (settings.semanticVideoModel && !isValid(settings.semanticVideoModel, presets.semanticVideo)) {
    updates.semanticVideoModel = defaults.semanticVideoModel
  }
  if (
    settings.semanticSnapshotModel &&
    !isValid(settings.semanticSnapshotModel, presets.semanticSnapshot)
  ) {
    updates.semanticSnapshotModel = defaults.semanticSnapshotModel
  }
  if (
    settings.patternDetectionModel &&
    !isValid(settings.patternDetectionModel, presets.patternDetection)
  ) {
    updates.patternDetectionModel = defaults.patternDetectionModel
  }
  if (Object.keys(updates).length === 0) return false
  log.info(
    `[MainWindow] Reconciling stale managed-mode model picks for ${vendor}: ${Object.keys(updates).join(', ')}`,
  )
  captureSettings.save(updates)
  return true
}

function buildStatus(): MainWindowStatus {
  return {
    capturing: deps?.capture.isCapturingNow() ?? false,
    captureHotkeyLabel: deps?.getCaptureHotkeyLabel() ?? '',
  }
}

/**
 * Send current status to the renderer process
 */
export function sendStatusToRenderer(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const status = buildStatus()
  mainWindow.webContents.send('main-window:statusChanged', status)
}

/**
 * Broadcast an observation state update to the renderer.
 */
export function sendObservationUpdate(state: ObservationState): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('main-window:observationUpdate', state)
}

/**
 * Open (or focus) the main application window
 */
export function openMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    return
  }

  const appRoot = app.getAppPath()

  mainWindow = new BrowserWindow({
    width: 800,
    height: 720,
    resizable: false,
    minimizable: true,
    maximizable: false,
    title: 'MemoryLane',
    webPreferences: {
      preload: path.join(appRoot, 'out', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true,
    },
  })

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173/main-window.html')
  } else {
    mainWindow.loadFile(path.join(appRoot, 'out', 'renderer', 'main-window.html'))
  }

  mainWindow.on('close', (e) => {
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
}

/**
 * Get the main window instance
 */
export function getMainWindow(): BrowserWindow | null {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow
  }
  return null
}

/**
 * Build stats for the main window
 */
async function buildStats(): Promise<MainWindowStats> {
  if (!deps) {
    return {
      activityCount: 0,
      dbSize: 0,
      dateRange: { oldest: null, newest: null },
      apiUsage: null,
      totalRepetitiveHoursPerWeek: null,
    }
  }

  let activityCount = 0
  let dbSize = 0
  const dateRange: { oldest: number | null; newest: number | null } = { oldest: null, newest: null }

  try {
    activityCount = deps.storage.activities.count()
    dbSize = deps.storage.getDbSize()
    const range = deps.storage.activities.getDateRange()
    dateRange.oldest = range.oldest
    dateRange.newest = range.newest
  } catch (error) {
    log.error('[MainWindow] Error fetching storage stats:', error)
  }

  const stats = deps.usageTracker.getStats()
  const apiUsage: { requestCount: number; totalCost: number } | null = {
    requestCount: stats.requestCount,
    totalCost: stats.totalCost,
  }

  let totalRepetitiveHoursPerWeek: number | null = null
  try {
    const patterns = deps.storage.patterns.getAllPatterns()
    const activeWithDuration = patterns.filter(
      (p) => p.completedAt === null && p.estimatedHoursPerWeek !== null,
    )
    if (activeWithDuration.length > 0) {
      totalRepetitiveHoursPerWeek =
        Math.round(activeWithDuration.reduce((sum, p) => sum + p.estimatedHoursPerWeek!, 0) * 10) /
        10
    }
  } catch (error) {
    log.error('[MainWindow] Error computing pattern duration stats:', error)
  }

  return { activityCount, dbSize, dateRange, apiUsage, totalRepetitiveHoursPerWeek }
}

/**
 * Initialize IPC handlers for the main window
 */
export function initMainWindowIPC(dependencies: MainWindowDependencies): void {
  deps = dependencies

  log.info('[MainWindow] Initializing IPC handlers...')

  ipcMain.handle(
    'main-window:getEditionConfig',
    () => deps?.editionConfig ?? { edition: DEFAULT_EDITION },
  )
  ipcMain.handle('main-window:getAccessState', () => {
    if (!deps) {
      return {
        edition: DEFAULT_EDITION,
        isEnterpriseActivated: false,
        customerSubscriptionStatus: 'idle',
        enterpriseActivationStatus: null,
        error: null,
      } satisfies AccessState
    }
    return deps.accessProvider.getAccessState()
  })
  ipcMain.handle('main-window:refreshAccessState', async () => {
    if (!deps) {
      return {
        edition: DEFAULT_EDITION,
        isEnterpriseActivated: false,
        customerSubscriptionStatus: 'idle',
        enterpriseActivationStatus: null,
        error: null,
      } satisfies AccessState
    }

    await deps.accessProvider.refreshAccessState()
    return deps.accessProvider.getAccessState()
  })
  ipcMain.handle(
    'main-window:activateEnterpriseLicense',
    async (_event, activationCode: string) => {
      if (!deps) {
        return { success: false, error: 'Dependencies not initialized' }
      }

      try {
        await deps.accessProvider.activateEnterpriseLicense(activationCode)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Activation failed'
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle('main-window:getPendingConsent', async () => {
    if (!deps) return null
    try {
      return await deps.accessProvider.getPendingConsent()
    } catch (error) {
      log.warn('[MainWindow] Failed to fetch pending consent document:', error)
      return null
    }
  })

  ipcMain.handle('main-window:submitConsentDecision', async (_event, outcome: ConsentOutcome) => {
    if (!deps) {
      return { success: false, error: 'Dependencies not initialized' }
    }
    try {
      await deps.accessProvider.submitConsentDecision(outcome)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Consent request failed'
      return { success: false, error: message }
    }
  })

  // Theme
  ipcMain.handle('main-window:getTheme', () => {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  })

  nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(
        'main-window:themeChanged',
        nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      )
    }
  })

  ipcMain.handle('main-window:getStatus', () => {
    return buildStatus()
  })

  ipcMain.handle('main-window:toggleCapture', () => {
    if (!deps) {
      return {
        capturing: false,
        captureHotkeyLabel: '',
      }
    }

    if (deps.capture.isCapturingNow()) {
      deps.capture.requestStopCapture()
    } else {
      deps.capture.requestStartCapture()
    }

    void updateTrayMenu()

    return buildStatus()
  })

  // Vendor credentials & active-vendor management
  function emptyStatuses(): Record<Vendor, VendorStatus> {
    const out = {} as Record<Vendor, VendorStatus>
    for (const v of VENDORS) {
      out[v] = { hasKey: false, source: 'none', maskedKey: null, baseURL: null }
    }
    return out
  }

  ipcMain.handle('main-window:getCredentialStatuses', () => {
    if (!deps) return emptyStatuses()
    return deps.vendorCredentials.getAllStatuses()
  })

  ipcMain.handle(
    'main-window:saveCredentials',
    (_event: IpcMainInvokeEvent, vendor: Vendor, creds: VendorCredentials) => {
      if (!deps) {
        return { success: false, error: 'Dependencies not initialized' }
      }
      if (!(VENDORS as readonly string[]).includes(vendor)) {
        return { success: false, error: `Unknown vendor: ${vendor}` }
      }
      try {
        deps.vendorCredentials.saveCredentials(vendor, creds)
        deps.inferenceProvider.notifyConfigChanged()
        if (vendor === deps.captureSettingsManager.get().activeVendor) {
          void deps.semanticService.testConnection()
        }
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle('main-window:deleteCredentials', (_event: IpcMainInvokeEvent, vendor: Vendor) => {
    if (!deps) {
      return { success: false, error: 'Dependencies not initialized' }
    }
    if (!(VENDORS as readonly string[]).includes(vendor)) {
      return { success: false, error: `Unknown vendor: ${vendor}` }
    }
    try {
      deps.vendorCredentials.deleteCredentials(vendor)
      deps.inferenceProvider.notifyConfigChanged()
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  ipcMain.handle('main-window:setActiveVendor', (_event: IpcMainInvokeEvent, vendor: Vendor) => {
    if (!deps) {
      return { success: false, error: 'Dependencies not initialized' }
    }
    if (!(VENDORS as readonly string[]).includes(vendor)) {
      return { success: false, error: `Unknown vendor: ${vendor}` }
    }
    try {
      deps.captureSettingsManager.setActiveVendor(vendor)
      applyVendorSwitch(deps, deps.captureSettingsManager.get())
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Integrations
  const byName = Object.fromEntries(integrations.map((i) => [i.name, i]))
  ipcMain.handle('main-window:addToClaude', () => byName.claudeDesktop.register())
  ipcMain.handle('main-window:addToCursor', () => byName.cursor.register())
  ipcMain.handle('main-window:addToClaudeCode', () => byName.claudeCode.register())
  ipcMain.handle('main-window:getMcpStatus', () => {
    const status: McpRegistrationStatus = {}
    for (const integration of integrations) {
      status[integration.name] = integration.getStatus()
    }
    return status
  })

  ipcMain.handle('main-window:getLlmHealth', () => {
    if (!deps) {
      return {
        configured: false,
        state: 'not_configured',
        consecutiveFailures: 0,
        lastError: null,
        lastAttemptAt: null,
      }
    }
    return deps.semanticService.getLlmHealthStatus()
  })

  ipcMain.handle('main-window:testLlmConnection', async () => {
    if (!deps) return
    await deps.semanticService.testConnection()
  })

  // Subscription / managed key — provider chosen by backend (openrouter | vertex).
  deps.accessProvider.setUpdateCallback((state, payload) => {
    if (payload?.config && deps) {
      const cfg = payload.config
      const vendor: Vendor = cfg.provider === 'vertex' ? 'google' : 'openrouter'
      deps.vendorCredentials.saveManagedCredentials(vendor, {
        apiKey: cfg.apiKey,
        ...(cfg.project !== undefined ? { project: cfg.project } : {}),
        ...(cfg.location !== undefined ? { location: cfg.location } : {}),
      })
      // Auto-switch active vendor — managed config is authoritative.
      const settings = deps.captureSettingsManager.get()
      const switching = settings.activeVendor !== vendor
      if (switching) {
        log.info(`[MainWindow] Switching active vendor to ${vendor} (managed)`)
        deps.captureSettingsManager.setActiveVendor(vendor)
      }
      // In managed mode the UI only offers the vendor's preset grid, so any
      // non-preset model lingering in the remembered selection (e.g. from a
      // prior BYOK session with a freetext model id) is unreachable and stale.
      // Reset such slots to the vendor's preset default; valid preset picks
      // are preserved.
      const reconciled = reconcileManagedModelSelections(deps.captureSettingsManager, vendor)
      if (switching || reconciled) {
        applyVendorSwitch(deps, deps.captureSettingsManager.get())
      } else {
        deps.inferenceProvider.notifyConfigChanged()
      }
    }
    if (payload?.invalidate && deps) {
      for (const v of ['openrouter', 'google'] as const) {
        if (deps.vendorCredentials.getStatus(v).source === 'managed') {
          log.info(`[MainWindow] Invalidating stale managed key for ${v}`)
          deps.vendorCredentials.deleteCredentials(v)
        }
      }
      deps.inferenceProvider.notifyConfigChanged()
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('main-window:accessStateChanged', state)
      mainWindow.webContents.send('main-window:subscriptionUpdate', {
        status: state.customerSubscriptionStatus ?? 'idle',
        error: state.error ?? payload?.error,
      })
    }
  })

  ipcMain.handle('main-window:startCheckout', async (_event, plan: SubscriptionPlan) => {
    if (!deps) return
    await deps.accessProvider.startCheckout(plan)
  })

  ipcMain.handle('main-window:openSubscriptionPortal', async () => {
    if (!deps) return
    await deps.accessProvider.openSubscriptionPortal()
  })

  ipcMain.handle('main-window:getSubscriptionStatus', () => {
    if (!deps) return 'idle'
    return deps.accessProvider.getAccessState().customerSubscriptionStatus ?? 'idle'
  })

  // Patterns
  ipcMain.handle('main-window:getPatterns', () => {
    if (!deps) return []
    return deps.storage.patterns.getAllPatterns()
  })

  ipcMain.handle('main-window:approvePattern', (_event: IpcMainInvokeEvent, id: string) => {
    if (!deps) return { success: false, error: 'Dependencies not initialized' }
    try {
      deps.storage.patterns.approvePattern(id)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  ipcMain.handle('main-window:rejectPattern', (_event: IpcMainInvokeEvent, id: string) => {
    if (!deps) return { success: false, error: 'Dependencies not initialized' }
    try {
      deps.storage.patterns.rejectPattern(id)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  ipcMain.handle('main-window:completePattern', (_event: IpcMainInvokeEvent, id: string) => {
    if (!deps) return { success: false, error: 'Dependencies not initialized' }
    try {
      deps.storage.patterns.completePattern(id)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  ipcMain.handle('main-window:uncompletePattern', (_event: IpcMainInvokeEvent, id: string) => {
    if (!deps) return { success: false, error: 'Dependencies not initialized' }
    try {
      deps.storage.patterns.uncompletePattern(id)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  ipcMain.handle(
    'main-window:markPatternPromptCopied',
    (_event: IpcMainInvokeEvent, id: string) => {
      if (!deps) return { success: false, error: 'Dependencies not initialized' }
      try {
        deps.storage.patterns.markPromptCopied(id)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    },
  )

  // Stats
  ipcMain.handle('main-window:getStats', () => buildStats())

  ipcMain.handle(
    'main-window:chooseDatabaseExportDirectory',
    async (_event: IpcMainInvokeEvent, initialPath?: string) => {
      try {
        const result = await dialog.showOpenDialog(getMainWindow() ?? undefined, {
          properties: ['openDirectory', 'createDirectory'],
          defaultPath:
            typeof initialPath === 'string' && /\S/.test(initialPath) ? initialPath : undefined,
        })

        if (result.canceled) {
          return { cancelled: true }
        }

        return {
          cancelled: false,
          directoryPath: result.filePaths[0],
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to choose folder'
        return { cancelled: false, error: message }
      }
    },
  )

  // Shell — only allow https URLs to prevent arbitrary protocol execution
  ipcMain.handle('main-window:openExternal', (_event: IpcMainInvokeEvent, url: string) => {
    if (typeof url !== 'string' || !url.startsWith('https://')) return
    return shell.openExternal(url)
  })

  // Database export
  ipcMain.handle('main-window:exportDatabaseZip', async () => {
    if (!deps) {
      return { success: false, error: 'Dependencies not initialized' }
    }
    return exportDatabaseZip({ storage: deps.storage, parentWindow: getMainWindow() })
  })

  ipcMain.handle('main-window:syncDatabaseToRemote', async () => {
    if (!deps?.databaseUploadSync) {
      return { success: false, error: 'Not available' }
    }
    return deps.databaseUploadSync.triggerUpload()
  })

  // Observation (build exclusion list from live activity)
  ipcMain.handle('main-window:startObservation', (_event, durationMs: number) => {
    if (!deps) return null
    return deps.observation.start(durationMs)
  })

  ipcMain.handle('main-window:stopObservation', () => {
    if (!deps) return null
    return deps.observation.stop('user')
  })

  ipcMain.handle('main-window:getObservationState', () => {
    if (!deps) return null
    return deps.observation.getState()
  })

  // Installed apps + seen domains (for privacy UI)
  ipcMain.handle('main-window:listInstalledApps', () => listInstalledApps())

  ipcMain.handle('main-window:listSeenDomains', () => {
    if (!deps) return []
    return deps.storage.activities.getDistinctTlds()
  })

  // Capture settings
  ipcMain.handle('main-window:getCaptureSettings', () => {
    if (!deps) return null
    return deps.captureSettingsManager.get()
  })

  ipcMain.handle(
    'main-window:saveCaptureSettings',
    (_event: IpcMainInvokeEvent, partial: Partial<CaptureSettings>) => {
      if (!deps) return { success: false, error: 'Dependencies not initialized' }
      const previous = deps.captureSettingsManager.get()
      try {
        if (
          partial.captureHotkeyAccelerator !== undefined &&
          partial.captureHotkeyAccelerator !== previous.captureHotkeyAccelerator
        ) {
          const hotkeyResult = deps.reconfigureCaptureHotkey(partial.captureHotkeyAccelerator)
          if (!hotkeyResult.success) {
            return {
              success: false,
              error: hotkeyResult.error ?? 'Failed to update start/stop shortcut',
            }
          }
        }

        deps.captureSettingsManager.save(partial)
        deps.captureSettingsManager.applyToConstants()
        const updated = deps.captureSettingsManager.get()
        syncAutoStartSetting(updated.autoStartEnabled)
        deps.capture.updateActivityWindowConfig({
          minActivityDurationMs: updated.minActivityDurationMs,
          maxActivityDurationMs: updated.maxActivityDurationMs,
        })
        deps.updateExclusions({
          apps: updated.excludedApps,
          windowTitlePatterns: updated.excludedWindowTitlePatterns,
          urlPatterns: updated.excludedUrlPatterns,
          excludePrivateBrowsing: updated.excludePrivateBrowsing,
        })
        deps.semanticService.updatePipelinePreference(updated.semanticPipelineMode)
        deps.semanticService.updateRequestTimeoutMs(updated.semanticRequestTimeoutMs)
        applyModelSettings(deps, updated, previous)
        void updateTrayMenu()
        sendStatusToRenderer()
        void deps.databaseExportSync.onSettingsChanged()
        return { success: true }
      } catch (error) {
        if (
          partial.captureHotkeyAccelerator !== undefined &&
          partial.captureHotkeyAccelerator !== previous.captureHotkeyAccelerator
        ) {
          deps.reconfigureCaptureHotkey(previous.captureHotkeyAccelerator)
        }
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle('main-window:resetCaptureSettings', () => {
    if (!deps) return { success: false, error: 'Dependencies not initialized' }
    const previous = deps.captureSettingsManager.get()
    try {
      deps.captureSettingsManager.reset()
      deps.captureSettingsManager.applyToConstants()
      const updated = deps.captureSettingsManager.get()
      const hotkeyResult = deps.reconfigureCaptureHotkey(updated.captureHotkeyAccelerator)
      if (!hotkeyResult.success) {
        deps.captureSettingsManager.save(previous)
        deps.captureSettingsManager.applyToConstants()
        return {
          success: false,
          error: hotkeyResult.error ?? 'Failed to reset start/stop shortcut',
        }
      }
      syncAutoStartSetting(updated.autoStartEnabled)
      deps.capture.updateActivityWindowConfig({
        minActivityDurationMs: updated.minActivityDurationMs,
        maxActivityDurationMs: updated.maxActivityDurationMs,
      })
      deps.updateExclusions({
        apps: updated.excludedApps,
        windowTitlePatterns: updated.excludedWindowTitlePatterns,
        urlPatterns: updated.excludedUrlPatterns,
        excludePrivateBrowsing: updated.excludePrivateBrowsing,
      })
      deps.semanticService.updatePipelinePreference(updated.semanticPipelineMode)
      deps.semanticService.updateRequestTimeoutMs(updated.semanticRequestTimeoutMs)
      applyModelSettings(deps, updated, previous)
      void updateTrayMenu()
      sendStatusToRenderer()
      void deps.databaseExportSync.onSettingsChanged()
      return { success: true }
    } catch (error) {
      deps.reconfigureCaptureHotkey(previous.captureHotkeyAccelerator)
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })
}

function applyModelSettings(
  d: MainWindowDependencies,
  updated: CaptureSettings,
  previous: CaptureSettings,
): void {
  if (
    updated.semanticVideoModel !== previous.semanticVideoModel ||
    updated.semanticSnapshotModel !== previous.semanticSnapshotModel ||
    updated.activeVendor !== previous.activeVendor
  ) {
    const presets = VENDOR_PRESETS[updated.activeVendor]
    d.semanticService.updateModels(
      buildModelChain(updated.semanticVideoModel, presets.semanticVideo),
      buildModelChain(updated.semanticSnapshotModel, presets.semanticSnapshot),
    )
  }
  if (updated.patternDetectionModel !== previous.patternDetectionModel) {
    d.patternDetector?.updateModel(updated.patternDetectionModel)
  }
  if (updated.patternDetectionEnabled !== previous.patternDetectionEnabled) {
    d.patternDetector?.setEnabled(updated.patternDetectionEnabled)
  }
}
