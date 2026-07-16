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
import { syncAutoStartSetting } from '@main/system/auto-start'
import { DEFAULT_EDITION, type AppEditionConfig } from '../../shared/edition'
import { CLUSTER_VIEW_CONFIG, PURGE_CONFIRMATION_PHRASE } from '../../shared/constants'
import log from '@main/utils/logger'
import { updateTrayMenu } from './tray'
import { getUpdateInfo, quitAndInstall } from '@main/system/updater'
import { exportDatabaseZip } from './database-export'
import { exportLogsZip } from './logs-export'
import { importDatabase } from './database-import'
import {
  getPermissionStatus,
  openPermissionSettings,
  requestScreenRecording,
  type PermissionStatus,
} from './permissions'
import { integrations } from '../integrations'
import { listInstalledApps } from '../apps/installed-apps'
import type { VendorCredentialsManager } from '../settings/vendor-credentials-manager'
import { VENDORS } from '../../shared/types'
import { buildClusterInfo, isBelowNoiseFloor, type ClusterMember } from './cluster-view'
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
  ClusterSightingInfo,
  ClusterDetailInfo,
  ClustersView,
  ConsentOutcome,
  LlmHealthStatus,
  MainWindowStatus,
  MainWindowStats,
  MiningStatus,
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
import type { BackfillSummary } from '../services/task-miner/types'
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
    pauseCapture: (durationMs: number) => void
    resumeCapture: () => void
    getPauseState: () => { pausedUntilMs: number | null }
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
    urlPatterns: string[]
    excludePrivateBrowsing: boolean
  }) => void
  // Org-provided (centrally-synced) exclusions, surfaced read-only in the UI.
  getManagedExclusions: () => { apps: string[]; urlPatterns: string[] }
  databaseExportSync: {
    onSettingsChanged: () => Promise<void>
  }
  databaseUploadSync?: {
    triggerUpload: () => Promise<{ success: boolean; error?: string }>
  }
  logUploadSync?: {
    triggerUpload: () => Promise<{ success: boolean; error?: string }>
  }
  purgeAll: () => Promise<void>
  /** Dev-only: wipe all mined sightings/clusters and re-mine from scratch. */
  wipeAndRemineTasks?: () => Promise<BackfillSummary>
  /** Task-mining ledger progress; absent when the new miner is disabled. */
  getMiningStatus?: () => MiningStatus
  /** Dev-only: reopen failed mining days and kick a sweep. Returns days reopened. */
  retryFailedMiningDays?: () => number
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
    pausedUntilMs: deps?.capture.getPauseState().pausedUntilMs ?? null,
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
 * Broadcast task-mining ledger progress so the Patterns view can show the
 * sweep (especially the first 60-day backfill) as it happens.
 */
export function sendMiningProgress(status: MiningStatus): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('main-window:miningProgressChanged', status)
}

/**
 * Broadcast an observation state update to the renderer.
 */
export function sendObservationUpdate(state: ObservationState): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('main-window:observationUpdate', state)
}

/**
 * Broadcast the current org-provided (centrally-synced) exclusions to the
 * renderer so an open settings window reflects an IT edit without a reopen.
 */
export function sendManagedExclusionsUpdate(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !deps) return
  mainWindow.webContents.send('main-window:managedExclusionsUpdate', deps.getManagedExclusions())
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

  return { activityCount, dbSize, dateRange, apiUsage }
}

/**
 * Log user-initiated capture-settings changes as a concise per-field timeline.
 * Only fields that actually changed are logged; arrays are reported by entry
 * count so a single line stays readable. High-signal, low-frequency — exactly
 * the breadcrumbs needed when debugging "why did X stop working".
 */
function logCaptureSettingsChanges(previous: CaptureSettings, updated: CaptureSettings): void {
  const scalarFields: (keyof CaptureSettings)[] = [
    'autoStartEnabled',
    'visualThreshold',
    'maxScreenshotsForLlm',
    'minActivityDurationMs',
    'maxActivityDurationMs',
    'semanticRequestTimeoutMs',
    'semanticPipelineMode',
    'captureHotkeyAccelerator',
    'excludePrivateBrowsing',
    'activeVendor',
    'semanticVideoModel',
    'semanticSnapshotModel',
    'patternDetectionModel',
    'patternDetectionEnabled',
    'uploadDetailLevel',
  ]
  for (const field of scalarFields) {
    if (previous[field] !== updated[field]) {
      log.info(
        `[Settings] user changed ${field}: ${String(previous[field])} → ${String(updated[field])}`,
      )
    }
  }
  const arrayFields: (keyof CaptureSettings)[] = ['excludedApps', 'excludedUrlPatterns']
  for (const field of arrayFields) {
    const before = previous[field] as string[]
    const after = updated[field] as string[]
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      log.info(`[Settings] user changed ${field}: ${before.length} → ${after.length} entries`)
    }
  }
}

/**
 * Initialize IPC handlers for the main window
 */
export function initMainWindowIPC(dependencies: MainWindowDependencies): void {
  deps = dependencies

  log.info('[MainWindow] Initializing IPC handlers...')

  // Wrap an IPC handler so an otherwise-silent throw/rejection is logged in the
  // main process before it propagates to the renderer as a rejected invoke().
  // Use for handlers that don't already shape errors into their own
  // { success, error } result.
  const handle = (
    channel: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fn: (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
  ): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await fn(event, ...args)
      } catch (error) {
        log.error(`[MainWindow] IPC '${channel}' failed:`, error)
        throw error
      }
    })
  }

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
  handle('main-window:refreshAccessState', async () => {
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
        log.warn('[MainWindow] Enterprise license activation failed:', error)
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
      log.warn(`[MainWindow] Consent decision (${outcome}) failed:`, error)
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

  handle('main-window:getStatus', () => {
    return buildStatus()
  })

  handle('main-window:toggleCapture', () => {
    if (!deps) return buildStatus()

    if (deps.capture.isCapturingNow()) {
      log.info('[Settings] user stopped capture')
      deps.capture.requestStopCapture()
    } else {
      log.info('[Settings] user started capture')
      deps.capture.requestStartCapture()
    }

    // Tray + renderer are refreshed by the coordinator's onStateChanged.
    return buildStatus()
  })

  handle('main-window:pauseCapture', (_event, durationMs: number) => {
    if (!deps) return buildStatus()
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      log.warn(`[Settings] ignoring pauseCapture with invalid duration: ${durationMs}`)
      return buildStatus()
    }
    log.info(`[Settings] user paused capture for ${Math.round(durationMs / 1000)}s`)
    deps.capture.pauseCapture(durationMs)
    return buildStatus()
  })

  handle('main-window:resumeCapture', () => {
    if (!deps) return buildStatus()
    log.info('[Settings] user resumed capture from pause')
    deps.capture.resumeCapture()
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
      log.warn(`[MainWindow] Failed to delete credentials for ${vendor}:`, error)
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
      const previousVendor = deps.captureSettingsManager.get().activeVendor
      deps.captureSettingsManager.setActiveVendor(vendor)
      applyVendorSwitch(deps, deps.captureSettingsManager.get())
      if (previousVendor !== vendor) {
        log.info(`[Settings] user changed active vendor: ${previousVendor} → ${vendor}`)
      }
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      log.warn(`[MainWindow] Failed to set active vendor to ${vendor}:`, error)
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

  handle('main-window:testLlmConnection', async () => {
    if (!deps) return
    await deps.semanticService.testConnection()
  })

  // Subscription / managed key — provider chosen by backend (openrouter | vertex).
  deps.accessProvider.setUpdateCallback((state, payload) => {
    if (payload?.config && deps) {
      const cfg = payload.config
      const vendor: Vendor = cfg.provider === 'vertex' ? 'google' : 'openrouter'
      // Managed config is re-applied on every focus/poll; only react when it
      // actually changed, otherwise we'd clear caches and re-probe the LLM on
      // every window focus (DEU-176).
      const changed = deps.vendorCredentials.saveManagedCredentials(vendor, {
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
      } else if (changed) {
        // Genuine key rotation with no vendor/model change: refresh the SDK and
        // probe once to confirm the new key works.
        deps.inferenceProvider.notifyConfigChanged()
        void deps.semanticService.testConnection()
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

  handle('main-window:startCheckout', async (_event, plan: SubscriptionPlan) => {
    if (!deps) return
    await deps.accessProvider.startCheckout(plan)
  })

  handle('main-window:openSubscriptionPortal', async () => {
    if (!deps) return
    await deps.accessProvider.openSubscriptionPortal()
  })

  handle('main-window:getSubscriptionStatus', () => {
    if (!deps) return 'idle'
    return deps.accessProvider.getAccessState().customerSubscriptionStatus ?? 'idle'
  })

  // Frequency denominator: distinct captured days in the same window sightings
  // are retained for, so timesSeen and observedDays cover the same period.
  const countObservedDays = (now: number): number => {
    if (!deps) return 0
    const windowStart = now - CLUSTER_VIEW_CONFIG.STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000
    return deps.storage.activities.countDistinctActiveDays(windowStart, now)
  }

  // Patterns (task clusters)
  handle('main-window:getClusters', (): ClustersView => {
    if (!deps) return { clusters: [], hiddenCount: 0 }
    // One digest query for all members → stats, recurrence, title fallback (no N+1).
    const membersByCluster = new Map<string, ClusterMember[]>()
    for (const { clusterId, ...member } of deps.storage.clusters.getMemberDigest()) {
      let list = membersByCluster.get(clusterId)
      if (!list) {
        list = []
        membersByCluster.set(clusterId, list)
      }
      list.push(member)
    }
    const now = Date.now()
    const observedDays = countObservedDays(now)
    const infos = deps.storage.clusters
      .getAll()
      .map((c) => buildClusterInfo(c, membersByCluster.get(c.id) ?? [], observedDays, now))
      // Clusters with no in-window members are dead rows awaiting cleanup, not
      // "hidden noise" — exclude them from the view and the hidden count.
      .filter((c) => c.timesSeen > 0)
    const visible = infos.filter((c) => !isBelowNoiseFloor(c.timesSeen, c.totalActiveMin))
    return { clusters: visible, hiddenCount: infos.length - visible.length }
  })

  handle('main-window:getMiningStatus', (): MiningStatus => {
    return (
      deps?.getMiningStatus?.() ?? {
        state: 'idle',
        currentDay: null,
        pendingDays: 0,
        completedDays: 0,
        failedDays: 0,
        totalDays: 0,
      }
    )
  })

  handle('main-window:retryFailedMiningDays', (): { retried: number } => {
    return { retried: deps?.retryFailedMiningDays?.() ?? 0 }
  })

  handle(
    'main-window:getClusterDetail',
    (_event: IpcMainInvokeEvent, id: string): ClusterDetailInfo | null => {
      if (!deps) return null
      if (!deps.storage.clusters.getById(id)) return null

      const members = deps.storage.clusters.getMembers(id) // Sighting[], started_at ASC
      const sightings: ClusterSightingInfo[] = members
        .slice()
        .reverse() // newest-first for the instances list
        .map((m) => ({
          id: m.id,
          title: m.title,
          subject: m.subject,
          description: m.description,
          apps: m.apps,
          startedAt: m.startedAt,
          endedAt: m.endedAt,
          activeMin: Math.max(0, m.interactionMin),
          activityIds: m.activityIds,
        }))

      return { sightings }
    },
  )

  // Patterns (legacy PatternDetector view) — used when newTaskMinerEnabled is off.
  handle('main-window:getPatterns', () => {
    if (!deps) return []
    return deps.storage.patterns.getAllPatterns()
  })

  handle('main-window:getPatternDetail', (_event: IpcMainInvokeEvent, id: string) => {
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
      log.warn(`[MainWindow] Failed to approve pattern ${id}:`, error)
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
      log.warn(`[MainWindow] Failed to reject pattern ${id}:`, error)
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
      log.warn(`[MainWindow] Failed to complete pattern ${id}:`, error)
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
      log.warn(`[MainWindow] Failed to uncomplete pattern ${id}:`, error)
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

  ipcMain.handle('main-window:exportLogsZip', async () => {
    return exportLogsZip({ parentWindow: getMainWindow() })
  })

  ipcMain.handle('main-window:syncDatabaseToRemote', async () => {
    if (!deps?.databaseUploadSync) {
      return { success: false, error: 'Not available' }
    }
    return deps.databaseUploadSync.triggerUpload()
  })

  ipcMain.handle('main-window:syncLogsToRemote', async () => {
    if (!deps?.logUploadSync) {
      return { success: false, error: 'Not available' }
    }
    return deps.logUploadSync.triggerUpload()
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

  ipcMain.handle('main-window:wipeAndRemineTasks', async () => {
    if (!deps) {
      return { success: false as const, error: 'Dependencies not initialized' }
    }
    if (!deps.wipeAndRemineTasks) {
      return { success: false as const, error: 'Not available' }
    }
    try {
      const summary = await deps.wipeAndRemineTasks()
      return { success: true as const, summary }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to wipe and re-mine tasks'
      log.error('[MainWindow] Wipe & re-mine failed:', error)
      return { success: false as const, error: message }
    }
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

  ipcMain.handle('main-window:getManagedExclusions', () => {
    if (!deps) return { apps: [], urlPatterns: [] }
    return deps.getManagedExclusions()
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
        logCaptureSettingsChanges(previous, updated)
        syncAutoStartSetting(updated.autoStartEnabled)
        deps.capture.updateActivityWindowConfig({
          minActivityDurationMs: updated.minActivityDurationMs,
          maxActivityDurationMs: updated.maxActivityDurationMs,
        })
        deps.updateExclusions({
          apps: updated.excludedApps,
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
  ipcMain.handle('main-window:requestPermission', async (_event, kind: string) => {
    log.info(`[Permissions] requestPermission(${kind})`)
    if (kind !== 'accessibility' && kind !== 'screenRecording') {
      log.warn(`[Permissions] requestPermission ignored — unknown kind: ${kind}`)
      return getPermissionStatus()
    }
    if (kind === 'screenRecording') {
      await requestScreenRecording()
    } else {
      await openPermissionSettings(kind)
    }
    startPermissionPolling()
    return getPermissionStatus()
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
