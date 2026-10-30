/**
 * Main application window for Memorylane
 *
 * Provides a visible control surface alongside the system tray.
 * Singleton window that hides on close instead of destroying.
 */

import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent, nativeTheme, shell } from 'electron'
import { showOpenDialog, showSaveDialog } from '@main/ui/dialogs'
import path from 'node:path'
import { syncAutoStartSetting } from '@main/system/auto-start'
import { DEFAULT_EDITION, type AppEditionConfig } from '../../shared/edition'
import { PURGE_CONFIRMATION_PHRASE } from '../../shared/constants'
import log from '@main/utils/logger'
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
import { VENDORS } from '../../shared/types'
import { computeClustersView } from './cluster-view'
import { importRecordingScripts, listRecordingScripts } from '@main/eval/recording-scripts'
import {
  buildWindowedActivities,
  dayString,
  renderSightingGoldenMd,
} from '../eval/task-fixture-build'
import { TASK_FIXTURE_SCHEMA_VERSION } from '../eval/task-types'
import type { PromoteCaptureResult } from '@main/eval/promote-fixture'
import type { EvalRecordingStatus, GoldenBlock, TaskSightingSummary } from '@/shared/eval-review'
import {
  closeRecordingGuide,
  resizeRecordingGuide,
  showRecordingGuide,
} from '@main/ui/recording-guide-window'
import type {
  AccessState,
  ClusterSightingInfo,
  ClusterDetailInfo,
  ClustersView,
  ConsentOutcome,
  MainWindowStatus,
  MainWindowStats,
  MiningStatus,
  AppSettings,
  McpRegistrationStatus,
  ObservationState,
  SubscriptionPlan,
  Vendor,
  VendorCredentials,
  VendorStatus,
} from '../../shared/types'
import type { MainRuntime } from '@main/runtime'
import type { AppSettingsManager } from '@main/settings/app-settings-manager'
import type { VendorCredentialsManager } from '@main/settings/vendor-credentials-manager'
import type { AppSync } from '@main/sync'
import type { CaptureCoordinatorControls } from '@main/capture/capture-orchestrator'
import type { CaptureHotkeyManager } from '@main/capture/capture-hotkey-manager'
import type { ObservationController } from '@main/capture/observation-controller'

export interface MainWindowDependencies {
  editionConfig: AppEditionConfig
  settings: AppSettingsManager
  vendorCredentials: VendorCredentialsManager
  runtime: MainRuntime
  sync: AppSync
  capture: CaptureCoordinatorControls
  hotkey: CaptureHotkeyManager
  observation: ObservationController
}

let mainWindow: BrowserWindow | null = null
let deps: MainWindowDependencies | null = null
let isQuitting = false

app.on('before-quit', () => {
  isQuitting = true
})

function buildStatus(): MainWindowStatus {
  return {
    capturing: deps?.capture.isCapturingNow() ?? false,
    captureHotkeyLabel: deps?.hotkey.getLabel() ?? '',
    pausedUntilMs: deps?.capture.getPauseState().pausedUntilMs ?? null,
  }
}

/**
 * Send current status to the renderer process
 */
function sendStatusToRenderer(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const status = buildStatus()
  mainWindow.webContents.send('main-window:statusChanged', status)
}

/**
 * Broadcast task-mining ledger progress so the Patterns view can show the
 * sweep (especially the first 60-day backfill) as it happens.
 */
function sendMiningProgress(status: MiningStatus): void {
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
function sendManagedExclusionsUpdate(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !deps) return
  mainWindow.webContents.send(
    'main-window:managedExclusionsUpdate',
    deps.sync.getManagedExclusions(),
  )
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
  if (process.platform === 'darwin') void app.dock?.show()

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
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
    fullscreenable: false,
    title: 'Memorylane',
    webPreferences: {
      preload: path.join(appRoot, 'out', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
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
      if (process.platform === 'darwin') app.dock?.hide()
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

/** Gets the main window out of the way so a take starts in the user's own app. */
async function hideForRecording(): Promise<void> {
  const win = getMainWindow()
  if (!win) return
  if (process.platform === 'darwin') {
    win.hide()
    app.hide()
  } else win.minimize()
  await new Promise((resolve) => setTimeout(resolve, 500))
}

/** `<script>-YYYY-MM-DD-HH-MM-SS` in local time; a free recording is just the stamp. */
function recordingName(scriptId: string | undefined): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  return scriptId ? `${scriptId}-${stamp}` : stamp
}

let startingEvalRecording = false

async function startEvalRecording(scriptId: string | undefined): Promise<EvalRecordingStatus> {
  if (!deps) throw new Error('Dependencies not initialized')
  if (startingEvalRecording || deps.runtime.evalRecorder.isRecording()) {
    throw new Error('A recording is already in progress')
  }
  startingEvalRecording = true
  try {
    deps.runtime.evalRecorder.arm(recordingName(scriptId), scriptId)
    let status: EvalRecordingStatus
    try {
      await hideForRecording()
      status = deps.runtime.evalRecorder.beginCapture()
      await showRecordingGuide()
    } catch (error) {
      await deps.runtime.evalRecorder.cancel().catch((cancelError) => {
        log.warn('[MainWindow] Failed to cancel eval recording:', cancelError)
      })
      closeRecordingGuide()
      openMainWindow()
      throw error
    }
    deps.runtime.requestUiRefresh()
    return status
  } finally {
    startingEvalRecording = false
  }
}

/** Stops the take and promotes it, then brings the app back for review. */
async function finishEvalRecording(): Promise<PromoteCaptureResult> {
  if (!deps) throw new Error('Dependencies not initialized')
  try {
    return await deps.runtime.evalRecorder.stop()
  } finally {
    closeRecordingGuide()
    deps?.runtime.requestUiRefresh()
    openMainWindow()
  }
}

/** Tray action: stops an eval recording without switching back to the app mid-take. */
export async function stopEvalRecordingFromTray(): Promise<void> {
  try {
    const result = await finishEvalRecording()
    log.info(`[EvalRecorder] Stopped from tray -> ${result.fixtureDir}`)
  } catch (error) {
    log.warn('[EvalRecorder] Tray stop failed:', error)
  }
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
    activityCount = deps.runtime.storage.activities.count()
    dbSize = deps.runtime.storage.getDbSize()
    const range = deps.runtime.storage.activities.getDateRange()
    dateRange.oldest = range.oldest
    dateRange.newest = range.newest
  } catch (error) {
    log.error('[MainWindow] Error fetching storage stats:', error)
  }

  const stats = deps.runtime.usageTracker.getStats()
  const apiUsage: { requestCount: number; totalCost: number } | null = {
    requestCount: stats.requestCount,
    totalCost: stats.totalCost,
  }

  return { activityCount, dbSize, dateRange, apiUsage }
}

/**
 * Log user-initiated settings changes as a concise per-field timeline.
 * Only fields that actually changed are logged; arrays are reported by entry
 * count so a single line stays readable. High-signal, low-frequency — exactly
 * the breadcrumbs needed when debugging "why did X stop working".
 */
function logAppSettingsChanges(previous: AppSettings, updated: AppSettings): void {
  const scalarFields: (keyof AppSettings)[] = [
    'autoStartEnabled',
    'visualThreshold',
    'maxScreenshotsForLlm',
    'minActivityDurationMs',
    'maxActivityDurationMs',
    'activityRequestTimeoutMs',
    'taskMiningRequestTimeoutMs',
    'semanticPipelineMode',
    'captureHotkeyAccelerator',
    'excludePrivateBrowsing',
    'excludeLoginScreens',
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
  const arrayFields: (keyof AppSettings)[] = ['excludedApps', 'excludedUrlPatterns']
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
  dependencies.runtime.onUiRefresh(sendStatusToRenderer)
  dependencies.sync.onManagedExclusionsChanged(sendManagedExclusionsUpdate)
  dependencies.runtime.taskMiner.setStatusListener(() =>
    sendMiningProgress(dependencies.runtime.taskMiner.getStatus()),
  )

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
    return deps.sync.access.getAccessState()
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

    await deps.sync.access.refreshAccessState()
    return deps.sync.access.getAccessState()
  })
  ipcMain.handle(
    'main-window:activateEnterpriseLicense',
    async (_event, activationCode: string) => {
      if (!deps) {
        return { success: false, error: 'Dependencies not initialized' }
      }

      try {
        await deps.sync.access.activateEnterpriseLicense(activationCode)
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
      return await deps.sync.access.getPendingConsent()
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
      await deps.sync.access.submitConsentDecision(outcome)
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
        deps.runtime.credentialsChanged()
        if (vendor === deps.settings.get().activeVendor) {
          void deps.runtime.semanticService.testConnection()
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
      deps.runtime.credentialsChanged()
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
      const previousVendor = deps.settings.get().activeVendor
      deps.settings.setActiveVendor(vendor)
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
    return deps.runtime.semanticService.getLlmHealthStatus()
  })

  handle('main-window:testLlmConnection', async () => {
    if (!deps) return
    await deps.runtime.semanticService.testConnection()
  })

  // Subscription / managed key — provider chosen by backend (openrouter | vertex).
  deps.sync.access.addUpdateListener((state, payload) => {
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
      const settings = deps.settings.get()
      const switching = settings.activeVendor !== vendor
      if (switching) {
        log.info(`[MainWindow] Switching active vendor to ${vendor} (managed)`)
        deps.settings.setActiveVendor(vendor)
      } else if (changed) {
        deps.runtime.credentialsChanged()
        void deps.runtime.semanticService.testConnection()
      }
      if (switching || changed) {
        void deps.sync.remoteModels.sync()
      }
    }
    if (payload?.invalidate && deps) {
      for (const v of ['openrouter', 'google'] as const) {
        if (deps.vendorCredentials.getStatus(v).source === 'managed') {
          log.info(`[MainWindow] Invalidating stale managed key for ${v}`)
          deps.vendorCredentials.deleteCredentials(v)
        }
      }
      deps.runtime.credentialsChanged()
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
    await deps.sync.access.startCheckout(plan)
  })

  handle('main-window:openSubscriptionPortal', async () => {
    if (!deps) return
    await deps.sync.access.openSubscriptionPortal()
  })

  handle('main-window:getSubscriptionStatus', () => {
    if (!deps) return 'idle'
    return deps.sync.access.getAccessState().customerSubscriptionStatus ?? 'idle'
  })

  // Patterns (task clusters)
  handle('main-window:getClusters', (): ClustersView => {
    if (!deps) return { clusters: [], hiddenCount: 0 }
    const { clusters, hiddenCount } = computeClustersView(deps.runtime.storage, Date.now())
    return { clusters, hiddenCount }
  })

  handle('main-window:getMiningStatus', (): MiningStatus => {
    return (
      deps?.runtime.taskMiner.getStatus() ?? {
        state: 'idle',
        currentDay: null,
        pendingDays: 0,
        completedDays: 0,
        failedDays: 0,
        totalDays: 0,
        failure: null,
      }
    )
  })

  handle('main-window:retryFailedMiningDays', (): { retried: number } => {
    return { retried: deps?.runtime.taskMiner.retryFailed() ?? 0 }
  })

  handle(
    'main-window:getClusterDetail',
    (_event: IpcMainInvokeEvent, id: string): ClusterDetailInfo | null => {
      if (!deps) return null
      if (!deps.runtime.storage.clusters.getById(id)) return null

      const members = deps.runtime.storage.clusters.getMembers(id) // Sighting[], started_at ASC
      const sightings: ClusterSightingInfo[] = members
        .slice()
        .reverse() // newest-first for the instances list
        .map((m) => ({
          id: m.id,
          title: m.title,
          subject: m.subject,
          apps: m.apps,
          startedAt: m.startedAt,
          activeMin: Math.max(0, m.interactionMin),
          activityIds: m.activityIds,
        }))

      return { sightings }
    },
  )

  // Activities
  ipcMain.handle(
    'main-window:listRecentActivities',
    (_event: IpcMainInvokeEvent, limit: number, offset?: number) => {
      if (!deps) return []
      return deps.runtime.storage.activities.listRecent(limit, offset ?? 0)
    },
  )

  ipcMain.handle('main-window:getActivityDigest', () => {
    if (!deps) {
      return {
        totalCount: 0,
        dateRange: { oldest: null, newest: null },
        topApps: [],
      }
    }
    return {
      totalCount: deps.runtime.storage.activities.count(),
      dateRange: deps.runtime.storage.activities.getDateRange(),
      topApps: deps.runtime.storage.activities.getTopApps(8),
    }
  })

  // Stats
  ipcMain.handle('main-window:getStats', () => buildStats())

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
    return exportDatabaseZip({ storage: deps.runtime.storage, parentWindow: getMainWindow() })
  })

  ipcMain.handle('main-window:importDatabase', async () => {
    if (!deps) {
      return { success: false, error: 'Dependencies not initialized' }
    }
    return importDatabase({
      dbPath: deps.runtime.storage.getDbPath(),
      parentWindow: getMainWindow(),
    })
  })

  ipcMain.handle('main-window:exportLogsZip', async () => {
    return exportLogsZip({ parentWindow: getMainWindow() })
  })

  ipcMain.handle('main-window:syncDatabaseToRemote', async () => {
    if (!deps?.sync.databaseUpload) {
      return { success: false, error: 'Not available' }
    }
    return deps.sync.databaseUpload.triggerUpload()
  })

  ipcMain.handle('main-window:syncLogsToRemote', async () => {
    if (!deps?.sync.logUpload) {
      return { success: false, error: 'Not available' }
    }
    return deps.sync.logUpload.triggerUpload()
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
        await deps.runtime.purgeAll()
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
    try {
      const summary = await deps.runtime.taskMiner.wipeAndRemine()
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
    return deps.sync.getManagedExclusions()
  })

  // Installed apps + seen domains (for privacy UI)
  ipcMain.handle('main-window:listInstalledApps', () => listInstalledApps())

  ipcMain.handle('main-window:listSeenDomains', () => {
    if (!deps) return []
    return deps.runtime.storage.activities.getDistinctTlds()
  })

  // Capture settings
  ipcMain.handle('main-window:getAppSettings', () => {
    if (!deps) return null
    return deps.settings.get()
  })

  ipcMain.handle(
    'main-window:saveAppSettings',
    (_event: IpcMainInvokeEvent, partial: Partial<AppSettings>) => {
      if (!deps) return { success: false, error: 'Dependencies not initialized' }
      const previous = deps.settings.get()
      const sanitized: Partial<AppSettings> = { ...partial }
      try {
        if (
          sanitized.captureHotkeyAccelerator !== undefined &&
          sanitized.captureHotkeyAccelerator !== previous.captureHotkeyAccelerator
        ) {
          const hotkeyResult = deps.hotkey.reconfigure(sanitized.captureHotkeyAccelerator)
          if (!hotkeyResult.success) {
            return {
              success: false,
              error: hotkeyResult.error ?? 'Failed to update start/stop shortcut',
            }
          }
        }

        deps.settings.save(sanitized)
        deps.settings.applyToConstants()
        const updated = deps.settings.get()
        logAppSettingsChanges(previous, updated)
        syncAutoStartSetting(updated.autoStartEnabled)
        deps.runtime.requestUiRefresh()
        return { success: true }
      } catch (error) {
        if (
          sanitized.captureHotkeyAccelerator !== undefined &&
          sanitized.captureHotkeyAccelerator !== previous.captureHotkeyAccelerator
        ) {
          deps.hotkey.reconfigure(previous.captureHotkeyAccelerator)
        }
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    },
  )

  ipcMain.handle('main-window:resetAppSettings', () => {
    if (!deps) return { success: false, error: 'Dependencies not initialized' }
    const previous = deps.settings.get()
    try {
      deps.settings.reset()
      deps.settings.applyToConstants()
      const updated = deps.settings.get()
      const hotkeyResult = deps.hotkey.reconfigure(updated.captureHotkeyAccelerator)
      if (!hotkeyResult.success) {
        deps.settings.save(previous)
        deps.settings.applyToConstants()
        return {
          success: false,
          error: hotkeyResult.error ?? 'Failed to reset start/stop shortcut',
        }
      }
      syncAutoStartSetting(updated.autoStartEnabled)
      deps.runtime.requestUiRefresh()
      return { success: true }
    } catch (error) {
      deps.hotkey.reconfigure(previous.captureHotkeyAccelerator)
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
  ipcMain.handle(
    'main-window:evalStartRecording',
    async (_event: IpcMainInvokeEvent, scriptId: unknown) => {
      try {
        const status = await startEvalRecording(typeof scriptId === 'string' ? scriptId : undefined)
        return { success: true as const, status }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : 'Failed' }
      }
    },
  )

  ipcMain.handle('main-window:evalListScripts', () => {
    if (!deps) return []
    try {
      return listRecordingScripts(deps.runtime.evalRecorder.fixturesRoot)
    } catch (error) {
      log.warn('[Eval] Failed to read scenarios', error)
      return []
    }
  })

  ipcMain.handle('main-window:evalImportScripts', async () => {
    if (!deps) return { success: false as const, error: 'Dependencies not initialized' }
    const result = await showOpenDialog(getMainWindow(), {
      title: 'Import Scenarios',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePaths[0]) {
      return { success: false as const, error: 'Canceled' }
    }
    try {
      const count = importRecordingScripts(
        deps.runtime.evalRecorder.fixturesRoot,
        result.filePaths[0],
      )
      return { success: true as const, count }
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  ipcMain.handle('main-window:evalStopRecording', async () => {
    try {
      const result = await finishEvalRecording()
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

  ipcMain.handle('main-window:evalCancelRecording', async () => {
    if (!deps) return { success: false as const, error: 'Dependencies not initialized' }
    try {
      await deps.runtime.evalRecorder.cancel()
      return { success: true as const }
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : 'Failed' }
    } finally {
      closeRecordingGuide()
      deps?.runtime.requestUiRefresh()
      openMainWindow()
    }
  })

  ipcMain.handle('main-window:evalRestartRecording', async () => {
    if (!deps) return { success: false as const, error: 'Dependencies not initialized' }
    try {
      const { scriptId } = deps.runtime.evalRecorder.getStatus()
      await deps.runtime.evalRecorder.cancel()
      const status = deps.runtime.evalRecorder.start(
        recordingName(scriptId ?? undefined),
        scriptId ?? undefined,
      )
      return { success: true as const, status }
    } catch (error) {
      closeRecordingGuide()
      deps?.runtime.requestUiRefresh()
      openMainWindow()
      return { success: false as const, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  ipcMain.on('main-window:evalResizeGuide', (_event, height: unknown) => {
    if (typeof height === 'number') resizeRecordingGuide(height)
  })

  ipcMain.handle(
    'main-window:evalOpenSetupUrl',
    async (_event: IpcMainInvokeEvent, url: unknown) => {
      const known =
        deps !== null &&
        listRecordingScripts(deps.runtime.evalRecorder.fixturesRoot).some((s) =>
          s.setup.some((item) => item.url === url),
        )
      if (typeof url !== 'string' || !known)
        return { success: false as const, error: 'Unknown URL' }
      await shell.openExternal(url)
      return { success: true as const }
    },
  )

  ipcMain.handle('main-window:evalRecordingStatus', () => {
    return (
      deps?.runtime.evalRecorder.getStatus() ?? {
        recording: false,
        name: null,
        startedAt: null,
        scriptId: null,
        stepEnteredAt: [],
        saving: false,
      }
    )
  })

  ipcMain.handle('main-window:evalListFixtures', () => {
    return deps?.runtime.evalFixtureStore.list() ?? []
  })

  ipcMain.handle('main-window:evalLoadFixture', (_event: IpcMainInvokeEvent, name: unknown) => {
    if (!deps || typeof name !== 'string') return null
    return deps.runtime.evalFixtureStore.load(name)
  })

  ipcMain.handle(
    'main-window:evalSaveGolden',
    (_event: IpcMainInvokeEvent, name: unknown, markdown: unknown) => {
      if (!deps) return { success: false as const, error: 'Dependencies not initialized' }
      if (typeof name !== 'string' || typeof markdown !== 'string') {
        return { success: false as const, error: 'Invalid arguments' }
      }
      try {
        deps.runtime.evalFixtureStore.saveGolden(name, markdown)
        return { success: true as const }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : 'Failed' }
      }
    },
  )

  ipcMain.handle(
    'main-window:evalSaveGoldenBlocks',
    (_event: IpcMainInvokeEvent, name: unknown, blocks: unknown) => {
      if (!deps) return { success: false as const, error: 'Dependencies not initialized' }
      if (typeof name !== 'string' || !Array.isArray(blocks)) {
        return { success: false as const, error: 'Invalid arguments' }
      }
      try {
        deps.runtime.evalFixtureStore.saveGoldenBlocks(name, blocks as GoldenBlock[])
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
      deps.runtime.evalFixtureStore.delete(name)
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
      const result = await showSaveDialog(getMainWindow(), {
        title: 'Export Eval Fixture',
        defaultPath: path.join(app.getPath('desktop'), `${name}.zip`),
        buttonLabel: 'Export',
        filters: [{ name: 'ZIP Archives', extensions: ['zip'] }],
      })
      if (result.canceled || !result.filePath) return { success: false as const, error: 'Canceled' }
      try {
        await deps.runtime.evalFixtureStore.exportZip(name, result.filePath)
        return { success: true as const, path: result.filePath }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : 'Failed' }
      }
    },
  )

  ipcMain.handle('main-window:evalExportAllFixtures', async () => {
    if (!deps) return { success: false as const, error: 'Dependencies not initialized' }
    const stamp = new Date().toISOString().slice(0, 10)
    const result = await showSaveDialog(getMainWindow(), {
      title: 'Export All Recordings',
      defaultPath: path.join(app.getPath('desktop'), `eval-recordings-${stamp}.zip`),
      buttonLabel: 'Export',
      filters: [{ name: 'ZIP Archives', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) return { success: false as const, error: 'Canceled' }
    try {
      const count = await deps.runtime.evalFixtureStore.exportAllZip(result.filePath)
      return { success: true as const, count }
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : 'Failed' }
    }
  })

  // Task-mining goldens (Developer → Tasks tab). Source: mined sightings;
  // output: {userData}/task-fixtures via taskFixtureStore.
  ipcMain.handle('main-window:evalListTaskSightings', () => {
    if (!deps) return []
    return deps.runtime.storage.sightings.getAll(200).map(
      (s): TaskSightingSummary => ({
        id: s.id,
        title: s.title,
        description: s.description,
        apps: s.apps,
        activityIds: s.activityIds,
        detectedAt: s.detectedAt,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        activityCount: s.activityIds.length,
      }),
    )
  })

  ipcMain.handle(
    'main-window:evalPreviewTaskGolden',
    (_event: IpcMainInvokeEvent, sightingId: unknown, beforeMin: unknown, afterMin: unknown) => {
      if (!deps || typeof sightingId !== 'string') return null
      const before = typeof beforeMin === 'number' ? beforeMin : 60
      const after = typeof afterMin === 'number' ? afterMin : 60
      const sighting = deps.runtime.storage.sightings.getById(sightingId)
      if (!sighting) return null
      try {
        const { activities, dayStart, windowFrom, windowTo } = buildWindowedActivities(
          deps.runtime.storage,
          sighting.activityIds,
          before,
          after,
        )
        const name = `${sighting.title}-${dayString(dayStart)}`
        const goldenMd = renderSightingGoldenMd(
          name,
          {
            title: sighting.title,
            apps: sighting.apps,
            activityIds: sighting.activityIds,
            description: sighting.description,
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
      const sighting = deps.runtime.storage.sightings.getById(sightingId)
      if (!sighting) return { success: false as const, error: 'Sighting not found' }
      try {
        const { activities, dayStart } = buildWindowedActivities(
          deps.runtime.storage,
          sighting.activityIds,
          before,
          after,
        )
        const fixture = deps.runtime.taskFixtureStore.write(name, activities, goldenMd, {
          name,
          label: name,
          description: `Built from sighting "${sighting.title}"; ${activities.length} activities (±${before}/${after} min).`,
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
    return deps?.runtime.taskFixtureStore.list() ?? []
  })

  ipcMain.handle('main-window:evalLoadTaskFixture', (_event: IpcMainInvokeEvent, name: unknown) => {
    if (!deps || typeof name !== 'string') return null
    return deps.runtime.taskFixtureStore.load(name)
  })

  ipcMain.handle(
    'main-window:evalSaveTaskGolden',
    (_event: IpcMainInvokeEvent, name: unknown, markdown: unknown) => {
      if (!deps) return { success: false as const, error: 'Dependencies not initialized' }
      if (typeof name !== 'string' || typeof markdown !== 'string') {
        return { success: false as const, error: 'Invalid arguments' }
      }
      try {
        deps.runtime.taskFixtureStore.saveGolden(name, markdown)
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
        deps.runtime.taskFixtureStore.delete(name)
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
      const result = await showSaveDialog(getMainWindow(), {
        title: 'Export Task Golden',
        defaultPath: path.join(app.getPath('desktop'), `${name}.zip`),
        buttonLabel: 'Export',
        filters: [{ name: 'ZIP Archives', extensions: ['zip'] }],
      })
      if (result.canceled || !result.filePath) return { success: false as const, error: 'Canceled' }
      try {
        await deps.runtime.taskFixtureStore.exportZip(name, result.filePath)
        return { success: true as const, path: result.filePath }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : 'Failed' }
      }
    },
  )
}
