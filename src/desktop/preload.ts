import { contextBridge, ipcRenderer } from 'electron'
import type { ResearchClient } from '../research/types'

const client: ResearchClient = {
  snapshot: () => ipcRenderer.invoke('research:snapshot'),
  command: (command) => ipcRenderer.invoke('research:command', command),
  testConnection: () => ipcRenderer.invoke('research:test'),
  exportWorkspace: (id) => ipcRenderer.invoke('research:export', id),
  storage: {
    chooseDirectory: () => ipcRenderer.invoke('storage:choose-directory'),
    relocate: (token) => ipcRenderer.invoke('storage:relocate', token),
  },
}
contextBridge.exposeInMainWorld('questbranch', client)
