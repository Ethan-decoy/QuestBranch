import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import log from 'electron-log/main.js'
import { DesktopUpdates } from './app-updates'
import { createUpdateTransport } from './update-transport'
import { ProjectLibrary } from './project-library'
import { inspectProject, projectData, projectFolder } from './project-files'
import { projectCommandSchema } from './project-commands'
import { existsSync } from 'node:fs'
import { ResearchService } from './service'
import { PiModels } from './pi-models'
import { createElectronNetwork } from './network-electron'
import { createNetworkLog } from './network-log'
import { installHostFetch } from './network'
import { installNativeAppearance, windowAppearance } from './appearance'
import { loadStorageLocation } from './storage-location'

const directory = dirname(fileURLToPath(import.meta.url))
let service: ProjectLibrary
let disposeAppearance: (() => void) | undefined
let disposeNetwork: (() => void) | undefined
let disposeUpdates: (() => void) | undefined
// A second desktop instance must not treat the first instance's live turns as interrupted.
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()
app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0]
  if (window?.isMinimized()) window.restore()
  window?.show()
  window?.focus()
})
function createWindow() {
  const window = new BrowserWindow({
    show: false,
    width: 1536,
    height: 960,
    minWidth: 1050,
    minHeight: 700,
    ...windowAppearance(),
    title: 'QuestBranch · 问之',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(directory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL()
    if (url !== current && !url.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'file://'))
      event.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(directory, '../renderer/index.html'))
}
// Electron waits for the ESM entry point to finish evaluating before emitting ready.
// Keep initialization in the callback instead of awaiting ready at module scope.
void app
  .whenReady()
  .then(async () => {
    if (!primary) return
    if (process.platform === 'win32') app.setAppUserModelId('org.questbranch.app')
    disposeAppearance = installNativeAppearance()
    const userData = app.getPath('userData')
    const network = await createElectronNetwork(createNetworkLog(join(userData, 'logs')))
    const restoreFetch = installHostFetch(network)
    disposeNetwork = () => {
      network.shutdown()
      restoreFetch()
    }
    const location = loadStorageLocation(userData, process.env.QUESTBRANCH_DATA_DIR)
    let relocating = false
    let updates: DesktopUpdates | undefined
    let selection:
      | {
          directory: string
          token: string
          sender: number
          kind: 'project' | 'relocate'
          projectId: string
        }
      | undefined
    const writable = () => {
      if (relocating) throw new Error('正在迁移研究项目，请稍后重试')
      if (updates?.installing) throw new Error('正在安装更新，应用即将重启')
    }
    service = new ProjectLibrary(location.directory, userData, {
      codec: safeStorage.isEncryptionAvailable()
        ? {
            encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
            decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
          }
        : undefined,
      service: (store) =>
        new ResearchService(
          store,
          new PiModels(store, { openAuthUrl: (url) => shell.openExternal(url), network }),
          undefined,
          network,
        ),
    })
    const logUpdate = (phase: string, error?: unknown) => {
      // Record phase and a bounded code, never SDK URLs, headers or account data.
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      log.info('app-update', phase, /^[A-Z0-9_]{1,64}$/.test(code) ? code : '')
    }
    const updateTransport = await createUpdateTransport(network, (error) => {
      if (updates?.installing) updates.failed('install', error)
      else logUpdate('sdk-error', error)
    })
    updates = new DesktopUpdates(
      app.getVersion(),
      updateTransport.transport,
      () => relocating || service.hasActiveRuns,
      logUpdate,
      updateTransport.native,
    )
    ipcMain.handle('app-updates:state', () => updates!.state())
    ipcMain.handle('app-updates:check', () => updates!.check())
    ipcMain.handle('app-updates:download', () => updates!.download())
    ipcMain.handle('app-updates:install', () => updates!.install())
    ipcMain.handle('app-updates:open-release', () => updates!.openRelease())
    if (app.isPackaged) {
      const firstUpdateCheck = setTimeout(() => void updates!.check(), 15_000)
      const updateChecks = setInterval(() => void updates!.check(), 6 * 60 * 60_000)
      disposeUpdates = () => {
        clearTimeout(firstUpdateCheck)
        clearInterval(updateChecks)
      }
    }
    ipcMain.handle('research:snapshot', async (_, sinceVersion?: number) => {
      const snapshot =
        sinceVersion === undefined ? await service.snapshot() : await service.snapshot(sinceVersion)
      return snapshot
    })
    ipcMain.handle('research:command', (_, command) => {
      writable()
      return service.command(command)
    })
    ipcMain.handle('agents:reset-session', (_, runId) => {
      writable()
      return service.resetAgentSession(runId)
    })
    ipcMain.handle('research:test', (_, settings) => {
      writable()
      return service.testConnection(settings)
    })
    ipcMain.handle('models:providers', () => service.modelProviders())
    ipcMain.handle('agents:connect', (_, config) => {
      writable()
      return service.agent.connect(config)
    })
    ipcMain.handle('agents:state', (_, id) => service.agent.state(id))
    ipcMain.handle('agents:configure', (_, id, configId, value) => {
      writable()
      return service.agent.configure(id, configId, value)
    })
    ipcMain.handle('agents:authenticate', (_, id, methodId) => {
      writable()
      return service.agent.authenticate(id, methodId)
    })
    ipcMain.handle('agents:respond', (_, id, requestId, response) => {
      writable()
      return service.agent.respond(id, requestId, response)
    })
    ipcMain.handle('agents:disconnect', (_, id) => service.agent.disconnect(id))
    ipcMain.handle('models:auth-start', (_, settings, type) => {
      writable()
      return service.auth.start(settings, type)
    })
    ipcMain.handle('models:auth-status', (_, id) => service.auth.status(id))
    ipcMain.handle('models:auth-respond', (_, id, promptId, value) =>
      service.auth.respond(id, promptId, value),
    )
    ipcMain.handle('models:auth-cancel', (_, id) => service.auth.cancel(id))
    ipcMain.handle('models:auth-logout', (_, settings) => {
      writable()
      return service.auth.logout(settings)
    })
    ipcMain.handle('research:export', (_, id: string) => service.exportWorkspace(id))
    const chooseFolder = async (
      event: Electron.IpcMainInvokeEvent,
      kind: 'project' | 'relocate',
    ) => {
      writable()
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) throw new Error('请在问之窗口中选择文件夹')
      const result = await dialog.showOpenDialog(window, {
        title: kind === 'project' ? '选择研究项目文件夹' : '选择此项目的新位置',
        buttonLabel: '选择文件夹',
        properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
      })
      if (result.canceled || !result.filePaths[0]) return null
      const snapshot = await service.snapshot()
      const directory =
        kind === 'relocate'
          ? service.relocationDirectory(snapshot.activeProjectId ?? '', result.filePaths[0])
          : projectFolder(result.filePaths[0])
      const legacy = service.isLegacyDirectory(directory)
      const existing = existsSync(projectData(directory)) || legacy
      if (kind === 'relocate' && existing) throw new Error('此文件夹已有项目数据，请选择其他文件夹')
      if (existing) inspectProject(directory, legacy)
      selection = {
        directory,
        token: randomUUID(),
        sender: event.sender.id,
        kind,
        projectId: snapshot.activeProjectId ?? '',
      }
      return { directory: selection.directory, token: selection.token, existing }
    }
    const chosen = (
      event: Electron.IpcMainInvokeEvent,
      token: unknown,
      kind: 'project' | 'relocate',
    ) => {
      if (
        !selection ||
        selection.sender !== event.sender.id ||
        token !== selection.token ||
        selection.kind !== kind
      )
        throw new Error('请先选择项目文件夹')
      return selection
    }
    ipcMain.handle('projects:choose-directory', (event) => chooseFolder(event, 'project'))
    ipcMain.handle('projects:command', async (event, input) => {
      writable()
      const command = projectCommandSchema.parse(input)
      const directory =
        command.type === 'create-project' && command.directoryToken
          ? chosen(event, command.directoryToken, 'project').directory
          : undefined
      const result = await service.projectCommand(command, directory)
      if (command.type === 'create-project') selection = undefined
      return result
    })
    ipcMain.handle('projects:open', async (event, token) => {
      writable()
      const result = await service.openProject(chosen(event, token, 'project').directory)
      selection = undefined
      return result
    })
    ipcMain.handle('storage:choose-directory', (event) => chooseFolder(event, 'relocate'))
    ipcMain.handle('storage:relocate', async (event, token: unknown) => {
      writable()
      const selected = chosen(event, token, 'relocate')
      relocating = true
      try {
        await service.relocateProject(selected.projectId, selected.directory)
        selection = undefined
      } finally {
        relocating = false
      }
    })
    createWindow()
  })
  .catch((error: unknown) => {
    dialog.showErrorBox(
      '问之未能打开本地研究空间',
      error instanceof Error ? error.message : '初始化失败',
    )
    app.quit()
  })
app.on('activate', () => {
  if (primary && !BrowserWindow.getAllWindows().length) createWindow()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
// Windows must finish their beforeunload view saves before storage is closed.
app.on('will-quit', () => {
  disposeUpdates?.()
  disposeAppearance?.()
  service?.shutdown()
  disposeNetwork?.()
})
