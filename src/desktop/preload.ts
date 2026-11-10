import { contextBridge, ipcRenderer } from 'electron'
import type { ResearchClient } from '../research/types'

const client: ResearchClient = {
  updates: {
    state: () => ipcRenderer.invoke('app-updates:state'),
    check: () => ipcRenderer.invoke('app-updates:check'),
    download: () => ipcRenderer.invoke('app-updates:download'),
    install: () => ipcRenderer.invoke('app-updates:install'),
    openRelease: () => ipcRenderer.invoke('app-updates:open-release'),
  },
  snapshot: (sinceVersion?: number) => ipcRenderer.invoke('research:snapshot', sinceVersion),
  command: (command) => ipcRenderer.invoke('research:command', command),
  testConnection: (settings) => ipcRenderer.invoke('research:test', settings),
  modelProviders: () => ipcRenderer.invoke('models:providers'),
  agent: {
    connect: (config) => ipcRenderer.invoke('agents:connect', config),
    state: (id) => ipcRenderer.invoke('agents:state', id),
    authenticate: (id, methodId) => ipcRenderer.invoke('agents:authenticate', id, methodId),
    configure: (id, configId, value) => ipcRenderer.invoke('agents:configure', id, configId, value),
    respond: (id, requestId, response) =>
      ipcRenderer.invoke('agents:respond', id, requestId, response),
    disconnect: (id) => ipcRenderer.invoke('agents:disconnect', id),
  },
  auth: {
    start: (settings, type) => ipcRenderer.invoke('models:auth-start', settings, type),
    status: (id) => ipcRenderer.invoke('models:auth-status', id),
    respond: (id, promptId, value) =>
      ipcRenderer.invoke('models:auth-respond', id, promptId, value),
    cancel: (id) => ipcRenderer.invoke('models:auth-cancel', id),
    logout: (settings) => ipcRenderer.invoke('models:auth-logout', settings),
  },
  exportWorkspace: (id) => ipcRenderer.invoke('research:export', id),
  appearance: { setTheme: (theme) => ipcRenderer.invoke('appearance:theme', theme) },
  storage: {
    chooseDirectory: () => ipcRenderer.invoke('storage:choose-directory'),
    relocate: (token) => ipcRenderer.invoke('storage:relocate', token),
  },
}
contextBridge.exposeInMainWorld('questbranch', client)
