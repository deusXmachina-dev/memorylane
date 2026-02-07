// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer, shell } from 'electron'

console.log('[Preload] Script loading...')

// Expose settings API to renderer
contextBridge.exposeInMainWorld('settingsAPI', {
  getKeyStatus: () => {
    console.log('[Preload] getKeyStatus called, invoking IPC...')
    return ipcRenderer.invoke('settings:getKeyStatus')
  },
  saveApiKey: (key: string) => ipcRenderer.invoke('settings:saveApiKey', key),
  deleteApiKey: () => ipcRenderer.invoke('settings:deleteApiKey'),
  close: () => ipcRenderer.send('settings:close'),
  openExternal: (url: string) => shell.openExternal(url),
  addToClaude: () => ipcRenderer.invoke('settings:addToClaude'),
  addToCursor: () => ipcRenderer.invoke('settings:addToCursor'),
})

console.log('[Preload] settingsAPI exposed to renderer')

// Expose capture settings API to renderer
contextBridge.exposeInMainWorld('captureSettingsAPI', {
  get: () => {
    console.log('[Preload] captureSettings.get called, invoking IPC...')
    return ipcRenderer.invoke('capture-settings:get')
  },
  save: (partialSettings: unknown) => ipcRenderer.invoke('capture-settings:save', partialSettings),
  reset: () => ipcRenderer.invoke('capture-settings:reset'),
})

console.log('[Preload] captureSettingsAPI exposed to renderer')

// Expose main window API to renderer
contextBridge.exposeInMainWorld('mainWindowAPI', {
  getStatus: () => ipcRenderer.invoke('main-window:getStatus'),
  toggleCapture: () => ipcRenderer.invoke('main-window:toggleCapture'),
  openSettings: () => ipcRenderer.send('main-window:openSettings'),
  onStatusChanged: (callback: (status: unknown) => void) => {
    ipcRenderer.on('main-window:statusChanged', (_event, status) => callback(status))
  },
})

console.log('[Preload] mainWindowAPI exposed to renderer')
