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
  // Patterns
  getPatterns: () => ipcRenderer.invoke('main-window:getPatterns'),
  getPatternDetail: (id: string) => ipcRenderer.invoke('main-window:getPatternDetail', id),
  approvePattern: (id: string) => ipcRenderer.invoke('main-window:approvePattern', id),
  rejectPattern: (id: string) => ipcRenderer.invoke('main-window:rejectPattern', id),
  completePattern: (id: string) => ipcRenderer.invoke('main-window:completePattern', id),
  uncompletePattern: (id: string) => ipcRenderer.invoke('main-window:uncompletePattern', id),
  markPatternPromptCopied: (id: string) =>
    ipcRenderer.invoke('main-window:markPatternPromptCopied', id),
  // Theme
  getTheme: () => ipcRenderer.invoke('main-window:getTheme') as Promise<'dark' | 'light'>,
  onThemeChanged: (callback: (theme: 'dark' | 'light') => void) => {
    ipcRenderer.on('main-window:themeChanged', (_event, theme) => callback(theme))
  },
  // Activities
  listRecentActivities: (limit: number, offset?: number) =>
    ipcRenderer.invoke('main-window:listRecentActivities', limit, offset),
  // Stats
  getStats: () => ipcRenderer.invoke('main-window:getStats'),
  chooseDatabaseExportDirectory: (initialPath?: string) =>
    ipcRenderer.invoke('main-window:chooseDatabaseExportDirectory', initialPath),
  setDatabaseExportDirectory: (directoryPath: string) =>
    ipcRenderer.invoke('main-window:setDatabaseExportDirectory', directoryPath),
  // Database export
  exportDatabaseZip: () => ipcRenderer.invoke('main-window:exportDatabaseZip'),
  syncDatabaseToRemote: () => ipcRenderer.invoke('main-window:syncDatabaseToRemote'),
  purgeDatabase: (confirmation: string) =>
    ipcRenderer.invoke('main-window:purgeDatabase', confirmation),
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
  // Permissions
  getPermissionStatus: () => ipcRenderer.invoke('main-window:getPermissionStatus'),
  requestPermission: (kind: PermissionKind) =>
    ipcRenderer.invoke('main-window:requestPermission', kind),
  openPermissionSettings: (kind: PermissionKind) =>
    ipcRenderer.invoke('main-window:openPermissionSettings', kind),
  onPermissionStatusChanged: (callback: (status: unknown) => void) => {
    const handler = (_event: unknown, status: unknown): void => callback(status)
    ipcRenderer.on('main-window:permissionStatusChanged', handler)
    return () => {
      ipcRenderer.off('main-window:permissionStatusChanged', handler)
    }
  },
  // App lifecycle
  restartApp: () => ipcRenderer.invoke('main-window:restartApp'),
  // Host platform — read once at preload time; never changes mid-session.
  platform: process.platform,
})

console.log('[Preload] mainWindowAPI exposed to renderer')
