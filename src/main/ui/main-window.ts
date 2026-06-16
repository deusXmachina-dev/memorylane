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
import { PURGE_CONFIRMATION_PHRASE } from '../../shared/constants'
import log from '../logger'
import { updateTrayMenu } from './tray'
import { getUpdateInfo, quitAndInstall } from '../updater'
import { exportDatabaseZip } from './database-export'
import { importDatabase } from './database-import'
import { getPermissionStatus, openPermissionSettings, type PermissionStatus } from './permissions'
import { integrations } from '../integrations'
import { listInstalledApps } from '../apps/installed-apps'
import type { VendorCredentialsManager } from '../settings/vendor-credentials-manager'
import { VENDORS } from '../../shared/types'
import { VENDOR_PRESETS, getVendorDefaults } from '../../shared/vendor-defaults'
import { applyVendorSwitch } from './vendor-switch'
import { applyModelSettings } from './model-settings'
import type { EvalRecorder } from '../eval/eval-recorder'
import type { EvalFixtureStore } from '../eval/eval-fixture-store'
import type { TaskFixtureStore } from '../eval/task-fixture-store'
import {
  buildWindowedActivities,
  dayString,
  renderSightingGoldenMd,
} from '../eval/task-fixture-build'
import { TASK_FIXTURE_SCHEMA_VERSION } from '../eval/task-types'
import type { TaskSightingSummary } from '../../shared/eval-review'
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

interface UserContextBuilderService {
  updateModel(model: string): void
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
  userContextBuilder?: UserContextBuilderService
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
  purgeAll: () => Promise<void>
  observation: {
    start: (durationMs: number) => ObservationState
    stop: (reason: 'user' | 'timer') => ObservationState
    getState: () => ObservationState
  }
  evalRecorder: EvalRecorder
  evalFixtureStore: EvalFixtureStore
  taskFixtureStore: TaskFixtureStore
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
 * Broadcast the current auto-update state to the renderer so it can show the
 * "Relaunch to update" banner when an update is ready.
 */
export function sendUpdateState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('main-window:updateStateChanged', getUpdateInfo())
}

// Permission status broadcaster — the renderer subscribes while on the
// Permissions onboarding step. We poll macOS for status changes (no native
// notification exists) and push deltas to the renderer.
let permissionPollTimer: NodeJS.Timeout | null = null
let lastPermissionStatus: PermissionStatus | null = null
const PERMISSION_POLL_MS = 2000

function sendPermissionStatus(status: PermissionStatus): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('main-window:permissionStatusChanged', status)
}

function startPermissionPolling(): void {
  if (permissionPollTimer !== null) return
  permissionPollTimer = setInterval(() => {
    const status = getPermissionStatus()
    const prev = lastPermissionStatus
    const changed =
      prev === null ||
      prev.accessibility !== status.accessibility ||
      prev.screenRecording !== status.screenRecording
    if (changed) {
      lastPermissionStatus = status
      sendPermissionStatus(status)
    }
    if (status.accessibility === 'granted' && status.screenRecording === 'granted') {
      stopPermissionPolling()
    }
  }, PERMISSION_POLL_MS)
}

function stopPermissionPolling(): void {
  if (permissionPollTimer === null) return
  clearInterval(permissionPollTimer)
  permissionPollTimer = null
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
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 560,
    resizable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: true,
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

  // Stop the permission poll when no renderer is observing it. Hidden ≈ not
  // looking; `getPermissionStatus` from a re-shown / re-mounted renderer will
  // restart it.
  mainWindow.on('hide', stopPermissionPolling)
  mainWindow.on('closed', stopPermissionPolling)
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

  ipcMain.handle('main-window:getPatternDetail', (_event: IpcMainInvokeEvent, id: string) => {
    if (!deps) return null
    const detail = deps.storage.patterns.getPatternDetail(id)
    if (!detail) return null

    const allActivityIds = Array.from(new Set(detail.sightings.flatMap((s) => s.activityIds)))
    const activities = deps.storage.activities.getByIds(allActivityIds)
    const activityById = new Map(
      activities.map((a) => [
        a.id,
        {
          id: a.id,
          startTimestamp: a.startTimestamp,
          endTimestamp: a.endTimestamp,
          appName: a.appName,
          windowTitle: a.windowTitle,
          tld: a.tld,
          summary: a.summary,
        },
      ]),
    )

    return {
      pattern: detail.pattern,
      sightings: detail.sightings.map((s) => ({
        id: s.id,
        detectedAt: s.detectedAt,
        evidence: s.evidence,
        confidence: s.confidence,
        durationEstimateMin: s.durationEstimateMin,
        activities: s.activityIds
          .map((aid) => activityById.get(aid))
          .filter((a): a is NonNullable<typeof a> => a !== undefined),
      })),
    }
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

  // Activities
  ipcMain.handle(
    'main-window:listRecentActivities',
    (_event: IpcMainInvokeEvent, limit: number, offset?: number) => {
      if (!deps) return []
      return deps.storage.activities.listRecent(limit, offset ?? 0)
    },
  )

  ipcMain.handle('main-window:getActivityDigest', () => {
    if (!deps) {
      return {
        totalCount: 0,
        dateRange: { oldest: null, newest: null },
        topApps: [],
        topTlds: [],
      }
    }
    return {
      totalCount: deps.storage.activities.count(),
      dateRange: deps.storage.activities.getDateRange(),
      topApps: deps.storage.activities.getTopApps(8),
      topTlds: deps.storage.activities.getDistinctTlds(8),
    }
  })

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

  ipcMain.handle('main-window:importDatabase', async () => {
    if (!deps) {
      return { success: false, error: 'Dependencies not initialized' }
    }
    return importDatabase({ dbPath: deps.storage.getDbPath(), parentWindow: getMainWindow() })
  })

  ipcMain.handle('main-window:syncDatabaseToRemote', async () => {
    if (!deps?.databaseUploadSync) {
      return { success: false, error: 'Not available' }
    }
    return deps.databaseUploadSync.triggerUpload()
  })

  ipcMain.handle(
    'main-window:purgeDatabase',
    async (_event: IpcMainInvokeEvent, confirmation: unknown) => {
      if (!deps) {
        return { success: false, error: 'Dependencies not initialized' }
      }
      if (confirmation !== PURGE_CONFIRMATION_PHRASE) {
        return { success: false, error: 'Confirmation phrase did not match' }
      }
      try {
        await deps.purgeAll()
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to purge database'
        log.error('[MainWindow] Purge failed:', error)
        return { success: false, error: message }
      }
    },
  )

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
      // databaseExportDirectory is renderer-untrusted (path-traversal sink).
      // The only legitimate write path is `main-window:setDatabaseExportDirectory`,
      // which runs realpath + safe-root containment. Drop it here regardless of
      // value so a malicious renderer can't bypass that check.
      const sanitized: Partial<CaptureSettings> = { ...partial }
      if ('databaseExportDirectory' in sanitized) {
        delete sanitized.databaseExportDirectory
      }
      try {
        if (
          sanitized.captureHotkeyAccelerator !== undefined &&
          sanitized.captureHotkeyAccelerator !== previous.captureHotkeyAccelerator
        ) {
          const hotkeyResult = deps.reconfigureCaptureHotkey(sanitized.captureHotkeyAccelerator)
          if (!hotkeyResult.success) {
            return {
              success: false,
              error: hotkeyResult.error ?? 'Failed to update start/stop shortcut',
            }
          }
        }

        deps.captureSettingsManager.save(sanitized)
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
          sanitized.captureHotkeyAccelerator !== undefined &&
          sanitized.captureHotkeyAccelerator !== previous.captureHotkeyAccelerator
        ) {
          deps.reconfigureCaptureHotkey(previous.captureHotkeyAccelerator)
        }
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle(
    'main-window:setDatabaseExportDirectory',
    (_event: IpcMainInvokeEvent, requestedPath: unknown) => {
      if (!deps) return { success: false, error: 'Dependencies not initialized' }
      try {
        deps.captureSettingsManager.setDatabaseExportDirectory(requestedPath)
        void deps.databaseExportSync.onSettingsChanged()
        return { success: true }
      } catch (error) {
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

  // Permissions
  ipcMain.handle('main-window:getPermissionStatus', () => {
    const status = getPermissionStatus()
    lastPermissionStatus = status
    log.info(
      `[Permissions] getPermissionStatus → accessibility=${status.accessibility}, screenRecording=${status.screenRecording}`,
    )
    // Start polling so the renderer is notified when the user grants permissions
    // outside our flow (e.g., directly in System Settings). Self-stops once both
    // are granted.
    if (status.accessibility !== 'granted' || status.screenRecording !== 'granted') {
      startPermissionPolling()
    }
    return status
  })
  // The Grant button just opens the relevant System Settings pane and starts
  // polling. We intentionally do NOT fire the native TCC request here:
  //   - `isTrustedAccessibilityClient(true)` shows a separate native modal in
  //     addition to System Settings (confusing — two surfaces fighting for the
  //     user's attention), and in dev gets attributed to the responsible app
  //     (your IDE), not MemoryLane.
  //   - `desktopCapturer.getSources()` would also surface that modal once.
  // The app already shows up in System Settings via other paths (uIOhook
  // listening for accessibility, capture attempts for screen recording).
  ipcMain.handle('main-window:requestPermission', async (_event, kind: string) => {
    log.info(`[Permissions] requestPermission(${kind})`)
    if (kind !== 'accessibility' && kind !== 'screenRecording') {
      log.warn(`[Permissions] requestPermission ignored — unknown kind: ${kind}`)
      return getPermissionStatus()
    }
    await openPermissionSettings(kind)
    startPermissionPolling()
    return getPermissionStatus()
  })
  ipcMain.handle('main-window:openPermissionSettings', async (_event, kind: string) => {
    if (kind === 'accessibility' || kind === 'screenRecording') {
      log.info(`[Permissions] openPermissionSettings(${kind})`)
      await openPermissionSettings(kind)
      startPermissionPolling()
    }
  })
  ipcMain.handle('main-window:restartApp', () => {
    log.info('[App] Restart requested from renderer')
    app.relaunch()
    app.quit()
  })
  ipcMain.handle('main-window:getUpdateInfo', () => getUpdateInfo())
  ipcMain.handle('main-window:installUpdate', () => {
    log.info('[Updater] Install requested from renderer')
    void quitAndInstall()
  })

  // Eval recorder + fixture review (Developer mode). Handlers ship in every build
  // and are inert until the hidden UI invokes them.
  ipcMain.handle('main-window:evalStartRecording', (_event: IpcMainInvokeEvent, name: unknown) => {
    if (!deps) return { success: false as const, error: 'Dependencies not initialized' }
    try {
      const status = deps.evalRecorder.start(typeof name === 'string' ? name : '')
      return { success: true as const, status }
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  ipcMain.handle('main-window:evalStopRecording', async () => {
    if (!deps) return { success: false as const, error: 'Dependencies not initialized' }
    try {
      const result = await deps.evalRecorder.stop()
      return {
        success: true as const,
        fixture: {
          name: path.basename(result.fixtureDir),
          frameCount: result.frameCount,
          eventWindowCount: result.eventWindowCount,
          hasVideo: result.video?.ok ?? false,
        },
      }
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  ipcMain.handle('main-window:evalRecordingStatus', () => {
    return deps?.evalRecorder.getStatus() ?? { recording: false, name: null, startedAt: null }
  })

  ipcMain.handle('main-window:evalListFixtures', () => {
    return deps?.evalFixtureStore.list() ?? []
  })

  ipcMain.handle('main-window:evalLoadFixture', (_event: IpcMainInvokeEvent, name: unknown) => {
    if (!deps || typeof name !== 'string') return null
    return deps.evalFixtureStore.load(name)
  })

  ipcMain.handle(
    'main-window:evalSaveGolden',
    (_event: IpcMainInvokeEvent, name: unknown, markdown: unknown) => {
      if (!deps) return { success: false as const, error: 'Dependencies not initialized' }
      if (typeof name !== 'string' || typeof markdown !== 'string') {
        return { success: false as const, error: 'Invalid arguments' }
      }
      try {
        deps.evalFixtureStore.saveGolden(name, markdown)
        return { success: true as const }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : 'Failed' }
      }
    },
  )

  ipcMain.handle('main-window:evalDeleteFixture', (_event: IpcMainInvokeEvent, name: unknown) => {
    if (!deps) return { success: false as const, error: 'Dependencies not initialized' }
    if (typeof name !== 'string') return { success: false as const, error: 'Invalid arguments' }
    try {
      deps.evalFixtureStore.delete(name)
      return { success: true as const }
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  ipcMain.handle(
    'main-window:evalExportFixture',
    async (_event: IpcMainInvokeEvent, name: unknown) => {
      if (!deps) return { success: false as const, error: 'Dependencies not initialized' }
      if (typeof name !== 'string') return { success: false as const, error: 'Invalid arguments' }
      const result = await dialog.showSaveDialog(getMainWindow() ?? undefined, {
        title: 'Export Eval Fixture',
        defaultPath: path.join(app.getPath('desktop'), `${name}.zip`),
        buttonLabel: 'Export',
        filters: [{ name: 'ZIP Archives', extensions: ['zip'] }],
      })
      if (result.canceled || !result.filePath) return { success: false as const, error: 'Canceled' }
      try {
        await deps.evalFixtureStore.exportZip(name, result.filePath)
        return { success: true as const, path: result.filePath }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : 'Failed' }
      }
    },
  )

  // Task-mining goldens (Developer → Tasks tab). Source: legacy pattern-detection
  // sightings; output: {userData}/task-fixtures via taskFixtureStore.
  ipcMain.handle('main-window:evalListTaskSightings', () => {
    if (!deps) return []
    const sightings = deps.storage.patterns.getAllSightings()
    const allActivityIds = Array.from(new Set(sightings.flatMap((s) => s.activityIds)))
    const activities = deps.storage.activities.getByIds(allActivityIds)
    const spanById = new Map(activities.map((a) => [a.id, a]))
    return sightings.map((s): TaskSightingSummary => {
      const acts = s.activityIds
        .map((id) => spanById.get(id))
        .filter((a): a is NonNullable<typeof a> => a !== undefined)
      const startedAt = acts.length ? Math.min(...acts.map((a) => a.startTimestamp)) : null
      const endedAt = acts.length ? Math.max(...acts.map((a) => a.endTimestamp)) : null
      return {
        id: s.id,
        patternName: s.patternName,
        evidence: s.evidence,
        apps: s.patternApps,
        activityIds: s.activityIds,
        detectedAt: s.detectedAt,
        startedAt,
        endedAt,
        activityCount: s.activityIds.length,
      }
    })
  })

  ipcMain.handle(
    'main-window:evalPreviewTaskGolden',
    (_event: IpcMainInvokeEvent, sightingId: unknown, beforeMin: unknown, afterMin: unknown) => {
      if (!deps || typeof sightingId !== 'string') return null
      const before = typeof beforeMin === 'number' ? beforeMin : 60
      const after = typeof afterMin === 'number' ? afterMin : 60
      const sighting = deps.storage.patterns.getAllSightings().find((s) => s.id === sightingId)
      if (!sighting) return null
      try {
        const { activities, dayStart, windowFrom, windowTo } = buildWindowedActivities(
          deps.storage,
          sighting.activityIds,
          before,
          after,
        )
        const name = `${sighting.patternName}-${dayString(dayStart)}`
        const goldenMd = renderSightingGoldenMd(
          name,
          {
            title: sighting.patternName,
            apps: sighting.patternApps,
            activityIds: sighting.activityIds,
            description: sighting.evidence,
          },
          activities,
        )
        return { name, goldenMd, activityCount: activities.length, windowFrom, windowTo }
      } catch {
        return null
      }
    },
  )

  ipcMain.handle(
    'main-window:evalPromoteTaskSighting',
    (_event: IpcMainInvokeEvent, sightingId: unknown, opts: unknown) => {
      if (!deps) return { success: false as const, error: 'Dependencies not initialized' }
      if (typeof sightingId !== 'string' || typeof opts !== 'object' || opts === null) {
        return { success: false as const, error: 'Invalid arguments' }
      }
      const { beforeMin, afterMin, goldenMd, name } = opts as {
        beforeMin?: unknown
        afterMin?: unknown
        goldenMd?: unknown
        name?: unknown
      }
      const before = typeof beforeMin === 'number' ? beforeMin : 60
      const after = typeof afterMin === 'number' ? afterMin : 60
      if (typeof goldenMd !== 'string' || typeof name !== 'string') {
        return { success: false as const, error: 'Invalid arguments' }
      }
      const sighting = deps.storage.patterns.getAllSightings().find((s) => s.id === sightingId)
      if (!sighting) return { success: false as const, error: 'Sighting not found' }
      try {
        const { activities, dayStart } = buildWindowedActivities(
          deps.storage,
          sighting.activityIds,
          before,
          after,
        )
        const fixture = deps.taskFixtureStore.write(name, activities, goldenMd, {
          name,
          label: name,
          description: `Built from sighting "${sighting.patternName}"; ${activities.length} activities (±${before}/${after} min).`,
          activityCount: activities.length,
          sourceDay: dayString(dayStart),
          schemaVersion: TASK_FIXTURE_SCHEMA_VERSION,
        })
        return { success: true as const, fixture }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : 'Failed' }
      }
    },
  )

  ipcMain.handle('main-window:evalListTaskFixtures', () => {
    return deps?.taskFixtureStore.list() ?? []
  })

  ipcMain.handle('main-window:evalLoadTaskFixture', (_event: IpcMainInvokeEvent, name: unknown) => {
    if (!deps || typeof name !== 'string') return null
    return deps.taskFixtureStore.load(name)
  })

  ipcMain.handle(
    'main-window:evalSaveTaskGolden',
    (_event: IpcMainInvokeEvent, name: unknown, markdown: unknown) => {
      if (!deps) return { success: false as const, error: 'Dependencies not initialized' }
      if (typeof name !== 'string' || typeof markdown !== 'string') {
        return { success: false as const, error: 'Invalid arguments' }
      }
      try {
        deps.taskFixtureStore.saveGolden(name, markdown)
        return { success: true as const }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : 'Failed' }
      }
    },
  )

  ipcMain.handle(
    'main-window:evalDeleteTaskFixture',
    (_event: IpcMainInvokeEvent, name: unknown) => {
      if (!deps) return { success: false as const, error: 'Dependencies not initialized' }
      if (typeof name !== 'string') return { success: false as const, error: 'Invalid arguments' }
      try {
        deps.taskFixtureStore.delete(name)
        return { success: true as const }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : 'Failed' }
      }
    },
  )

  ipcMain.handle(
    'main-window:evalExportTaskFixture',
    async (_event: IpcMainInvokeEvent, name: unknown) => {
      if (!deps) return { success: false as const, error: 'Dependencies not initialized' }
      if (typeof name !== 'string') return { success: false as const, error: 'Invalid arguments' }
      const result = await dialog.showSaveDialog(getMainWindow() ?? undefined, {
        title: 'Export Task Golden',
        defaultPath: path.join(app.getPath('desktop'), `${name}.zip`),
        buttonLabel: 'Export',
        filters: [{ name: 'ZIP Archives', extensions: ['zip'] }],
      })
      if (result.canceled || !result.filePath) return { success: false as const, error: 'Canceled' }
      try {
        await deps.taskFixtureStore.exportZip(name, result.filePath)
        return { success: true as const, path: result.filePath }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : 'Failed' }
      }
    },
  )
}
