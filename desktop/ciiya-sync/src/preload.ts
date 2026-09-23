import { contextBridge, ipcRenderer } from 'electron'
import type {
  CiiyaSyncDesktopBridge,
  CiiyaSyncDesktopPreferences,
  CiiyaSyncDesktopState,
} from './contracts'

const bridge: CiiyaSyncDesktopBridge = {
  getState: () => ipcRenderer.invoke('ciiya-sync:get-state'),
  startPairing: () => ipcRenderer.invoke('ciiya-sync:start-pairing'),
  disconnect: () => ipcRenderer.invoke('ciiya-sync:disconnect'),
  refreshAlbums: () => ipcRenderer.invoke('ciiya-sync:refresh-albums'),
  chooseFolder: () => ipcRenderer.invoke('ciiya-sync:choose-folder'),
  savePreferences: (preferences: CiiyaSyncDesktopPreferences) =>
    ipcRenderer.invoke('ciiya-sync:save-preferences', preferences),
  startSync: () => ipcRenderer.invoke('ciiya-sync:start-sync'),
  stopSync: () => ipcRenderer.invoke('ciiya-sync:stop-sync'),
  installLightroomPlugin: () =>
    ipcRenderer.invoke('ciiya-sync:install-lightroom-plugin'),
  retryItem: (itemId: string) =>
    ipcRenderer.invoke('ciiya-sync:retry-item', itemId),
  cancelItem: (itemId: string) =>
    ipcRenderer.invoke('ciiya-sync:cancel-item', itemId),
  openPairingPage: () => ipcRenderer.invoke('ciiya-sync:open-pairing-page'),
  onState(listener: (state: CiiyaSyncDesktopState) => void) {
    const wrapped = (_event: Electron.IpcRendererEvent, state: CiiyaSyncDesktopState) =>
      listener(state)
    ipcRenderer.on('ciiya-sync:state-changed', wrapped)
    return () => ipcRenderer.removeListener('ciiya-sync:state-changed', wrapped)
  },
}

contextBridge.exposeInMainWorld('ciiyaSync', Object.freeze(bridge))
