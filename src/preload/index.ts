// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron'
import type { ConsentOutcome, PermissionKind, Vendor, VendorCredentials } from '../shared/types'

console.log('[Preload] Script loading...')

// Expose main window API to renderer (consolidated API)
contextBridge.exposeInMainWorld('mainWindowAPI', {
  getEditionConfig: () => ipcRenderer.invoke('main-window:getEditionConfig'),
  getAccessState: () => ipcRenderer.invoke('main-window:getAccessState'),
  refreshAccessState: () => ipcRenderer.invoke('main-window:refreshAccessState'),
  onAccessStateChanged: (callback: (state: unknown) => void) => {
    const handler = (_event: unknown, state: unknown): void => callback(state)
    ipcRenderer.on('main-window:accessStateChanged', handler)
    return () => {
      ipcRenderer.off('main-window:accessStateChanged', handler)
    }
  },
  activateEnterpriseLicense: (activationCode: string) =>
    ipcRenderer.invoke('main-window:activateEnterpriseLicense', activationCode),
  getPendingConsent: () => ipcRenderer.invoke('main-window:getPendingConsent'),
  submitConsentDecision: (outcome: ConsentOutcome) =>
    ipcRenderer.invoke('main-window:submitConsentDecision', outcome),
  // Capture control
  getStatus: () => ipcRenderer.invoke('main-window:getStatus'),
  toggleCapture: () => ipcRenderer.invoke('main-window:toggleCapture'),
  pauseCapture: (durationMs: number) => ipcRenderer.invoke('main-window:pauseCapture', durationMs),
  resumeCapture: () => ipcRenderer.invoke('main-window:resumeCapture'),
  onStatusChanged: (callback: (status: unknown) => void) => {
    const handler = (_event: unknown, status: unknown): void => callback(status)
    ipcRenderer.on('main-window:statusChanged', handler)
    return () => {
      ipcRenderer.off('main-window:statusChanged', handler)
    }
  },
  // Vendor credentials & active-vendor management
  getCredentialStatuses: () => ipcRenderer.invoke('main-window:getCredentialStatuses'),
  saveCredentials: (vendor: Vendor, creds: VendorCredentials) =>
    ipcRenderer.invoke('main-window:saveCredentials', vendor, creds),
  deleteCredentials: (vendor: Vendor) =>
    ipcRenderer.invoke('main-window:deleteCredentials', vendor),
  setActiveVendor: (vendor: Vendor) => ipcRenderer.invoke('main-window:setActiveVendor', vendor),
  // Integrations
  addToClaude: () => ipcRenderer.invoke('main-window:addToClaude'),
  addToCursor: () => ipcRenderer.invoke('main-window:addToCursor'),
  addToClaudeCode: () => ipcRenderer.invoke('main-window:addToClaudeCode'),
  getMcpStatus: () => ipcRenderer.invoke('main-window:getMcpStatus'),
  getLlmHealth: () => ipcRenderer.invoke('main-window:getLlmHealth'),
  testLlmConnection: () => ipcRenderer.invoke('main-window:testLlmConnection'),
  // Subscription
  startCheckout: (plan: string) => ipcRenderer.invoke('main-window:startCheckout', plan),
  openSubscriptionPortal: () => ipcRenderer.invoke('main-window:openSubscriptionPortal'),
  getSubscriptionStatus: () => ipcRenderer.invoke('main-window:getSubscriptionStatus'),
  onSubscriptionUpdate: (callback: (update: unknown) => void) => {
    const handler = (_event: unknown, update: unknown): void => callback(update)
    ipcRenderer.on('main-window:subscriptionUpdate', handler)
    return () => {
      ipcRenderer.off('main-window:subscriptionUpdate', handler)
    }
  },
  // Privacy metadata
  listInstalledApps: () => ipcRenderer.invoke('main-window:listInstalledApps'),
  listSeenDomains: () => ipcRenderer.invoke('main-window:listSeenDomains'),
  // Capture settings
  getCaptureSettings: () => ipcRenderer.invoke('main-window:getCaptureSettings'),
  saveCaptureSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke('main-window:saveCaptureSettings', settings),
  resetCaptureSettings: () => ipcRenderer.invoke('main-window:resetCaptureSettings'),
  // Patterns (task clusters) — new TaskMiner view
  getClusters: () => ipcRenderer.invoke('main-window:getClusters'),
  scrubTexts: (texts: string[], allow?: string[]) =>
    ipcRenderer.invoke('main-window:scrubTexts', texts, allow),
  getClusterDetail: (id: string) => ipcRenderer.invoke('main-window:getClusterDetail', id),
  // Task-mining progress (ledger sweep)
  getMiningStatus: () => ipcRenderer.invoke('main-window:getMiningStatus'),
  onMiningProgressChanged: (callback: (status: unknown) => void) => {
    const handler = (_event: unknown, status: unknown): void => callback(status)
    ipcRenderer.on('main-window:miningProgressChanged', handler)
    return () => {
      ipcRenderer.off('main-window:miningProgressChanged', handler)
    }
  },
  retryFailedMiningDays: () => ipcRenderer.invoke('main-window:retryFailedMiningDays'),
  // Theme
  getTheme: () => ipcRenderer.invoke('main-window:getTheme') as Promise<'dark' | 'light'>,
  onThemeChanged: (callback: (theme: 'dark' | 'light') => void) => {
    ipcRenderer.on('main-window:themeChanged', (_event, theme) => callback(theme))
  },
  // Activities
  listRecentActivities: (limit: number, offset?: number) =>
    ipcRenderer.invoke('main-window:listRecentActivities', limit, offset),
  getActivityDigest: () => ipcRenderer.invoke('main-window:getActivityDigest'),
  // Stats
  getStats: () => ipcRenderer.invoke('main-window:getStats'),
  chooseDatabaseExportDirectory: (initialPath?: string) =>
    ipcRenderer.invoke('main-window:chooseDatabaseExportDirectory', initialPath),
  setDatabaseExportDirectory: (directoryPath: string) =>
    ipcRenderer.invoke('main-window:setDatabaseExportDirectory', directoryPath),
  // Database export
  exportDatabaseZip: () => ipcRenderer.invoke('main-window:exportDatabaseZip'),
  exportLogsZip: () => ipcRenderer.invoke('main-window:exportLogsZip'),
  importDatabase: () => ipcRenderer.invoke('main-window:importDatabase'),
  syncDatabaseToRemote: () => ipcRenderer.invoke('main-window:syncDatabaseToRemote'),
  syncLogsToRemote: () => ipcRenderer.invoke('main-window:syncLogsToRemote'),
  purgeDatabase: (confirmation: string) =>
    ipcRenderer.invoke('main-window:purgeDatabase', confirmation),
  wipeAndRemineTasks: () => ipcRenderer.invoke('main-window:wipeAndRemineTasks'),
  // Shell
  openExternal: (url: string) => ipcRenderer.invoke('main-window:openExternal', url),
  // Observation (build exclusion list from live activity)
  startObservation: (durationMs: number) =>
    ipcRenderer.invoke('main-window:startObservation', durationMs),
  stopObservation: () => ipcRenderer.invoke('main-window:stopObservation'),
  getObservationState: () => ipcRenderer.invoke('main-window:getObservationState'),
  onObservationUpdate: (callback: (state: unknown) => void) => {
    const handler = (_event: unknown, state: unknown): void => callback(state)
    ipcRenderer.on('main-window:observationUpdate', handler)
    return () => {
      ipcRenderer.off('main-window:observationUpdate', handler)
    }
  },
  // Org-provided (centrally-synced) capture exclusions
  getManagedExclusions: () => ipcRenderer.invoke('main-window:getManagedExclusions'),
  onManagedExclusionsUpdate: (callback: (managed: unknown) => void) => {
    const handler = (_event: unknown, managed: unknown): void => callback(managed)
    ipcRenderer.on('main-window:managedExclusionsUpdate', handler)
    return () => {
      ipcRenderer.off('main-window:managedExclusionsUpdate', handler)
    }
  },
  // Permissions
  getPermissionStatus: () => ipcRenderer.invoke('main-window:getPermissionStatus'),
  requestPermission: (kind: PermissionKind) =>
    ipcRenderer.invoke('main-window:requestPermission', kind),
  onPermissionStatusChanged: (callback: (status: unknown) => void) => {
    const handler = (_event: unknown, status: unknown): void => callback(status)
    ipcRenderer.on('main-window:permissionStatusChanged', handler)
    return () => {
      ipcRenderer.off('main-window:permissionStatusChanged', handler)
    }
  },
  // Updater
  getUpdateInfo: () => ipcRenderer.invoke('main-window:getUpdateInfo'),
  installUpdate: () => ipcRenderer.invoke('main-window:installUpdate'),
  onUpdateStateChanged: (callback: (info: unknown) => void) => {
    const handler = (_event: unknown, info: unknown): void => callback(info)
    ipcRenderer.on('main-window:updateStateChanged', handler)
    return () => {
      ipcRenderer.off('main-window:updateStateChanged', handler)
    }
  },
  // App lifecycle
  restartApp: () => ipcRenderer.invoke('main-window:restartApp'),
  // Eval recorder + fixture review (Developer mode)
  evalStartRecording: (name: string) => ipcRenderer.invoke('main-window:evalStartRecording', name),
  evalStopRecording: () => ipcRenderer.invoke('main-window:evalStopRecording'),
  evalRecordingStatus: () => ipcRenderer.invoke('main-window:evalRecordingStatus'),
  evalListFixtures: () => ipcRenderer.invoke('main-window:evalListFixtures'),
  evalLoadFixture: (name: string) => ipcRenderer.invoke('main-window:evalLoadFixture', name),
  evalSaveGolden: (name: string, markdown: string) =>
    ipcRenderer.invoke('main-window:evalSaveGolden', name, markdown),
  evalDeleteFixture: (name: string) => ipcRenderer.invoke('main-window:evalDeleteFixture', name),
  evalExportFixture: (name: string) => ipcRenderer.invoke('main-window:evalExportFixture', name),
  // Task-mining goldens (Developer → Tasks tab)
  evalListTaskSightings: () => ipcRenderer.invoke('main-window:evalListTaskSightings'),
  evalPreviewTaskGolden: (sightingId: string, beforeMin: number, afterMin: number) =>
    ipcRenderer.invoke('main-window:evalPreviewTaskGolden', sightingId, beforeMin, afterMin),
  evalPromoteTaskSighting: (
    sightingId: string,
    opts: { beforeMin: number; afterMin: number; goldenMd: string; name: string },
  ) => ipcRenderer.invoke('main-window:evalPromoteTaskSighting', sightingId, opts),
  evalListTaskFixtures: () => ipcRenderer.invoke('main-window:evalListTaskFixtures'),
  evalLoadTaskFixture: (name: string) =>
    ipcRenderer.invoke('main-window:evalLoadTaskFixture', name),
  evalSaveTaskGolden: (name: string, markdown: string) =>
    ipcRenderer.invoke('main-window:evalSaveTaskGolden', name, markdown),
  evalDeleteTaskFixture: (name: string) =>
    ipcRenderer.invoke('main-window:evalDeleteTaskFixture', name),
  evalExportTaskFixture: (name: string) =>
    ipcRenderer.invoke('main-window:evalExportTaskFixture', name),
  // Host platform — read once at preload time; never changes mid-session.
  platform: process.platform,
})

console.log('[Preload] mainWindowAPI exposed to renderer')
