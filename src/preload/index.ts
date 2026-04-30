// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron'
import type { ConsentOutcome, ProviderConfigInput, ProviderConfigPatch } from '../shared/types'

console.log('[Preload] Script loading...')

// Expose main window API to renderer (consolidated API)
contextBridge.exposeInMainWorld('mainWindowAPI', {
  getEditionConfig: () => ipcRenderer.invoke('main-window:getEditionConfig'),
  getAccessState: () => ipcRenderer.invoke('main-window:getAccessState'),
  refreshAccessState: () => ipcRenderer.invoke('main-window:refreshAccessState'),
  onAccessStateChanged: (callback: (state: unknown) => void) => {
    ipcRenderer.on('main-window:accessStateChanged', (_event, state) => callback(state))
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
    ipcRenderer.on('main-window:statusChanged', (_event, status) => callback(status))
  },
  // API key status (read-only; legacy compatibility)
  getKeyStatus: () => ipcRenderer.invoke('main-window:getKeyStatus'),
  // Integrations
  addToClaude: () => ipcRenderer.invoke('main-window:addToClaude'),
  addToCursor: () => ipcRenderer.invoke('main-window:addToCursor'),
  addToClaudeCode: () => ipcRenderer.invoke('main-window:addToClaudeCode'),
  getMcpStatus: () => ipcRenderer.invoke('main-window:getMcpStatus'),
  // Custom endpoint status (read-only; legacy compatibility)
  getCustomEndpoint: () => ipcRenderer.invoke('main-window:getCustomEndpoint'),
  // Multi-provider registry
  listProviders: () => ipcRenderer.invoke('main-window:listProviders'),
  addProvider: (input: ProviderConfigInput) => ipcRenderer.invoke('main-window:addProvider', input),
  updateProvider: (id: string, patch: ProviderConfigPatch) =>
    ipcRenderer.invoke('main-window:updateProvider', { id, patch }),
  removeProvider: (id: string) => ipcRenderer.invoke('main-window:removeProvider', id),
  setActiveProvider: (id: string | null) => ipcRenderer.invoke('main-window:setActiveProvider', id),
  getLlmHealth: () => ipcRenderer.invoke('main-window:getLlmHealth'),
  testLlmConnection: () => ipcRenderer.invoke('main-window:testLlmConnection'),
  // Subscription
  startCheckout: (plan: string) => ipcRenderer.invoke('main-window:startCheckout', plan),
  openSubscriptionPortal: () => ipcRenderer.invoke('main-window:openSubscriptionPortal'),
  getSubscriptionStatus: () => ipcRenderer.invoke('main-window:getSubscriptionStatus'),
  onSubscriptionUpdate: (callback: (update: unknown) => void) => {
    ipcRenderer.on('main-window:subscriptionUpdate', (_event, update) => callback(update))
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
  // Stats
  getStats: () => ipcRenderer.invoke('main-window:getStats'),
  chooseDatabaseExportDirectory: (initialPath?: string) =>
    ipcRenderer.invoke('main-window:chooseDatabaseExportDirectory', initialPath),
  // Database export
  exportDatabaseZip: () => ipcRenderer.invoke('main-window:exportDatabaseZip'),
  syncDatabaseToRemote: () => ipcRenderer.invoke('main-window:syncDatabaseToRemote'),
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
})

console.log('[Preload] mainWindowAPI exposed to renderer')
