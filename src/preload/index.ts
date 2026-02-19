// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron'

console.log('[Preload] Script loading...')

// Expose main window API to renderer (consolidated API)
contextBridge.exposeInMainWorld('mainWindowAPI', {
  // Capture control
  getStatus: () => ipcRenderer.invoke('main-window:getStatus'),
  toggleCapture: () => ipcRenderer.invoke('main-window:toggleCapture'),
  onStatusChanged: (callback: (status: unknown) => void) => {
    ipcRenderer.on('main-window:statusChanged', (_event, status) => callback(status))
  },
  // API key management
  getKeyStatus: () => ipcRenderer.invoke('main-window:getKeyStatus'),
  saveApiKey: (key: string) => ipcRenderer.invoke('main-window:saveApiKey', key),
  deleteApiKey: () => ipcRenderer.invoke('main-window:deleteApiKey'),
  // Integrations
  addToClaude: () => ipcRenderer.invoke('main-window:addToClaude'),
  addToCursor: () => ipcRenderer.invoke('main-window:addToCursor'),
  addToClaudeCode: () => ipcRenderer.invoke('main-window:addToClaudeCode'),
  // Custom endpoint
  getCustomEndpoint: () => ipcRenderer.invoke('main-window:getCustomEndpoint'),
  saveCustomEndpoint: (config: { serverURL: string; model: string; apiKey?: string }) =>
    ipcRenderer.invoke('main-window:saveCustomEndpoint', config),
  deleteCustomEndpoint: () => ipcRenderer.invoke('main-window:deleteCustomEndpoint'),
  // Subscription
  startCheckout: () => ipcRenderer.invoke('main-window:startCheckout'),
  openSubscriptionPortal: () => ipcRenderer.invoke('main-window:openSubscriptionPortal'),
  getSubscriptionStatus: () => ipcRenderer.invoke('main-window:getSubscriptionStatus'),
  onSubscriptionUpdate: (callback: (update: unknown) => void) => {
    ipcRenderer.on('main-window:subscriptionUpdate', (_event, update) => callback(update))
  },
  // Capture settings
  getCaptureSettings: () => ipcRenderer.invoke('main-window:getCaptureSettings'),
  saveCaptureSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke('main-window:saveCaptureSettings', settings),
  resetCaptureSettings: () => ipcRenderer.invoke('main-window:resetCaptureSettings'),
  // Stats
  getStats: () => ipcRenderer.invoke('main-window:getStats'),
})

console.log('[Preload] mainWindowAPI exposed to renderer')
