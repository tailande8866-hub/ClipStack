import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getHistory: (search?: string, limit?: number, offset?: number) =>
    ipcRenderer.invoke('history:get', search, limit, offset),

  copyToClipboard: (id: number) =>
    ipcRenderer.invoke('clipboard:copy', id),

  pinItem: (id: number, pinned: boolean) =>
    ipcRenderer.invoke('history:pin', id, pinned),

  deleteItem: (id: number) =>
    ipcRenderer.invoke('history:delete', id),

  readImageData: (imagePath: string) =>
    ipcRenderer.invoke('image:read', imagePath),

  getSetting: (key: string) =>
    ipcRenderer.invoke('settings:get', key),

  setSetting: (key: string, value: string) =>
    ipcRenderer.invoke('settings:set', key, value),

  onNewItem: (callback: (item: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, item: unknown) => callback(item)
    ipcRenderer.on('clipboard:new-item', listener)
    return () => ipcRenderer.removeListener('clipboard:new-item', listener)
  },

  collapseToFloat: () => ipcRenderer.send('window:collapse'),

  expandFromFloat: () => ipcRenderer.send('window:expand'),

  showFloatMenu: () => ipcRenderer.send('window:menu'),

  setFloatIgnore: (ignore: boolean) => ipcRenderer.send('float:ignore', ignore),

  quitApp: () => ipcRenderer.send('app:quit'),

  openSettings: () => ipcRenderer.send('window:settings'),

  getSettingsInfo: () => ipcRenderer.invoke('settings:info'),

  chooseDataDir: () => ipcRenderer.invoke('settings:choose-dir'),

  applyDataDir: (dir: string) => ipcRenderer.invoke('settings:apply-dir', dir),

  resetDataDir: () => ipcRenderer.invoke('settings:reset-dir'),

  openDataDir: (dir?: string) => ipcRenderer.invoke('settings:open-dir', dir),

  setAutostart: (enabled: boolean) => ipcRenderer.invoke('settings:set-autostart', enabled),

  minimizeSettings: () => ipcRenderer.send('settings:minimize'),

  closeSettings: () => ipcRenderer.send('settings:close'),

  onDataChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('data:changed', listener)
    return () => ipcRenderer.removeListener('data:changed', listener)
  },

  openExternal: (url: string) => ipcRenderer.invoke('settings:open-external', url),

  copyText: (text: string) => ipcRenderer.invoke('settings:copy-text', text),

  exportDiagnostics: () => ipcRenderer.invoke('settings:export-diagnostics'),

  getDiagnosticsText: () => ipcRenderer.invoke('settings:diagnostics-text'),

  checkUpdate: () => ipcRenderer.invoke('settings:check-update'),

  getUpdateStatus: () => ipcRenderer.invoke('settings:update-status'),

  setAutoCheckUpdate: (enabled: boolean) => ipcRenderer.invoke('settings:set-auto-update', enabled),

  onUpdateAvailable: (callback: (info: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: unknown) => callback(info)
    ipcRenderer.on('update:available', listener)
    return () => ipcRenderer.removeListener('update:available', listener)
  },
})
