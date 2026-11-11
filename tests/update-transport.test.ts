import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Network } from '../src/desktop/network'
import { DesktopUpdates } from '../src/desktop/app-updates'

const host = vi.hoisted(() => ({
  packaged: true,
  installed: true,
  version: '0.3.0-dev.6',
  open: vi.fn(),
  relaunch: vi.fn(),
  quit: vi.fn(),
  beforeReplace: vi.fn<(source: string, destination: string) => void>(),
  appImageDownload: undefined as { path: string; sha512: string } | undefined,
}))
vi.mock('electron', () => ({
  app: {
    getVersion: () => host.version,
    get isPackaged() {
      return host.packaged
    },
    relaunch: host.relaunch,
  },
  shell: { openExternal: host.open },
}))
vi.doMock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return {
    ...fs,
    existsSync: () => host.installed,
    renameSync: (source: string, destination: string) => {
      host.beforeReplace(source, destination)
      fs.renameSync(source, destination)
    },
  }
})
const sdk = Object.assign(new EventEmitter(), {
  netSession: { setProxy: vi.fn(async () => {}) },
  setFeedURL: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
  autoDownload: true,
  autoInstallOnAppQuit: true,
  autoRunAppAfterInstall: false,
  allowDowngrade: true,
  allowPrerelease: true,
  disableWebInstaller: false,
  logger: {},
})
vi.doMock('electron-updater', () => {
  class AppImageUpdater extends EventEmitter {
    netSession = sdk.netSession
    setFeedURL = sdk.setFeedURL
    checkForUpdates = sdk.checkForUpdates
    downloadUpdate = sdk.downloadUpdate
    get installerPath() {
      return host.appImageDownload?.path
    }
    get downloadedUpdateHelper() {
      return { downloadedFileInfo: host.appImageDownload }
    }
    protected doInstall(): boolean {
      throw new Error('AppImage replacement must use the QuestBranch implementation')
    }
    quitAndInstall(silent: boolean, forceRun: boolean) {
      sdk.quitAndInstall(silent, forceRun)
      try {
        if (this.doInstall()) host.quit()
      } catch (error) {
        this.emit('error', error)
      }
    }
  }
  return {
    default: {
      AppImageUpdater,
      get autoUpdater() {
        return process.platform === 'linux' ? new AppImageUpdater() : sdk
      },
    },
  }
})
const { createUpdateTransport, supportsNativeUpdate, isAppImageMount } =
  await import('../src/desktop/update-transport')
const entry = (version = '0.3.0-dev.7') => ({
  tag_name: `v${version}`,
  draft: false,
  prerelease: version.includes('-'),
  assets: [{ name: 'dev.yml' }],
})
beforeEach(() => {
  vi.clearAllMocks()
  sdk.removeAllListeners()
  host.packaged = true
  host.installed = true
  host.version = '0.3.0-dev.6'
  host.appImageDownload = undefined
})
function network(fetch = vi.fn<typeof globalThis.fetch>()) {
  return { fetch, run: (_context, work) => work() } satisfies Network
}

it('does not treat an inherited APPIMAGE as this application’s installation', () => {
  const mount = resolve('fixture/own-mount')
  expect(isAppImageMount('QuestBranch.AppImage', mount, resolve(mount, 'questbranch'))).toBe(true)
  expect(
    isAppImageMount('Parent.AppImage', mount, resolve('fixture/installed-deb/questbranch')),
  ).toBe(false)
  expect(isAppImageMount('Parent.AppImage', undefined, resolve(mount, 'questbranch'))).toBe(false)
  expect(isAppImageMount(undefined, mount, resolve(mount, 'questbranch'))).toBe(false)
  expect(isAppImageMount('Parent.AppImage', mount, mount)).toBe(false)
})

it('detects native installation capability without enabling directory, DMG or DEB replacement', () => {
  expect(supportsNativeUpdate('win32', true, true)).toBe(true)
  expect(supportsNativeUpdate('linux', true, true)).toBe(true)
  expect(supportsNativeUpdate('win32', true, false)).toBe(false)
  expect(supportsNativeUpdate('linux', false, true)).toBe(false)
  expect(supportsNativeUpdate('darwin', true, true)).toBe(false)
})
it.each(['rename failure', 'digest mismatch'])(
  'preserves the current AppImage through a %s and retries the verified replacement',
  async (failure) => {
    const directory = mkdtempSync(join(tmpdir(), 'qb-update-'))
    const original = join(directory, 'QuestBranch Custom.AppImage')
    const downloaded = join(directory, 'download.AppImage')
    const oldImage = '#!/bin/sh\nprintf "old executable"\n'
    const newImage = '#!/bin/sh\nprintf "new executable"\n'
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    try {
      Object.defineProperty(process, 'platform', { ...platform, value: 'linux' })
      vi.stubEnv('APPIMAGE', original)
      vi.stubEnv('APPDIR', dirname(process.execPath))
      writeFileSync(original, oldImage)
      chmodSync(original, 0o755)
      writeFileSync(downloaded, failure === 'digest mismatch' ? 'changed' : newImage)
      host.appImageDownload = {
        path: downloaded,
        sha512: createHash('sha512').update(newImage).digest('base64'),
      }
      if (failure === 'rename failure') {
        host.beforeReplace.mockImplementationOnce((stage, destination) => {
          expect(dirname(dirname(stage))).toBe(directory)
          expect(destination).toBe(original)
          expect(readFileSync(stage, 'utf8')).toBe(newImage)
          expect(readFileSync(original, 'utf8')).toBe(oldImage)
          throw Object.assign(new Error('No space left on device'), { code: 'ENOSPC' })
        })
      }
      sdk.checkForUpdates.mockResolvedValue({
        isUpdateAvailable: true,
        updateInfo: { version: '0.3.0-dev.7' },
      })
      sdk.downloadUpdate.mockResolvedValue([downloaded])
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation(async (url) =>
          String(url).endsWith('/latest')
            ? new Response(null, { status: 404 })
            : Response.json([{ ...entry(), assets: [{ name: 'dev-safe-linux.yml' }] }]),
        )
      const report = vi.fn<(error: Error) => void>()
      const { transport, native } = await createUpdateTransport(network(fetch), report)
      const updates = new DesktopUpdates(host.version, transport, () => false, vi.fn(), native)
      report.mockImplementation((error) => updates.failed('install', error))
      expect(native).toBe(true)
      expect(await updates.check()).toMatchObject({ phase: 'available', installation: 'native' })
      expect((await updates.download()).phase).toBe('ready')
      expect(sdk.setFeedURL).toHaveBeenCalledWith(expect.objectContaining({ channel: 'dev-safe' }))
      expect(await updates.install()).toMatchObject({ phase: 'ready', problem: 'install' })
      if (failure === 'rename failure')
        expect(report).toHaveBeenCalledWith(expect.objectContaining({ code: 'ENOSPC' }))
      else expect(host.beforeReplace).not.toHaveBeenCalled()
      expect(readFileSync(original, 'utf8')).toBe(oldImage)
      if (platform.value === 'linux')
        expect(execFileSync(original, { encoding: 'utf8' })).toBe('old executable')
      expect(host.relaunch).not.toHaveBeenCalled()
      expect(host.quit).not.toHaveBeenCalled()

      writeFileSync(downloaded, newImage)
      expect((await updates.install()).phase).toBe('installing')
      expect(readFileSync(original, 'utf8')).toBe(newImage)
      if (platform.value === 'linux')
        expect(execFileSync(original, { encoding: 'utf8' })).toBe('new executable')
      expect(readdirSync(directory).sort()).toEqual(
        ['QuestBranch Custom.AppImage', 'download.AppImage'].sort(),
      )
      expect(host.relaunch).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ execPath: original }),
      )
      expect(host.quit).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(process, 'platform', platform)
      vi.unstubAllEnvs()
      rmSync(original, { force: true })
      rmSync(downloaded, { force: true })
      rmdirSync(directory)
    }
  },
)
it.runIf(process.platform === 'win32')(
  'uses the OS proxy, disables surprise downloads/install-on-quit and pins downloads to the selected version',
  async () => {
    const { transport, native } = await createUpdateTransport(network(), vi.fn())
    expect(native).toBe(true)
    expect(sdk.netSession.setProxy).toHaveBeenCalledWith({ mode: 'system' })
    expect(sdk).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowDowngrade: false,
    })
    sdk.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '0.3.0-dev.7' },
    })
    sdk.downloadUpdate.mockResolvedValue(['fixture.exe'])
    await transport.download({ version: '0.3.0-dev.7', native: true }, vi.fn())
    expect(sdk.setFeedURL).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'generic',
        url: 'https://github.com/Ethan-decoy/QuestBranch/releases/download/v0.3.0-dev.7/',
        channel: 'dev',
      }),
    )
    expect(sdk.downloadUpdate).toHaveBeenCalledTimes(1)
    transport.install()
    expect(sdk.quitAndInstall).toHaveBeenCalledWith(true, true)
  },
)
it.runIf(process.platform === 'win32')(
  'does not download a feed that changes the selected version',
  async () => {
    const { transport } = await createUpdateTransport(network(), vi.fn())
    sdk.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '0.3.0-dev.8' },
    })
    await expect(
      transport.download({ version: '0.3.0-dev.7', native: true }, vi.fn()),
    ).rejects.toThrow('differs')
    expect(sdk.downloadUpdate).not.toHaveBeenCalled()
  },
)
it.runIf(process.platform === 'win32')(
  'a failed native updater initialization falls back to manual updates instead of blocking research startup',
  async () => {
    sdk.netSession.setProxy.mockRejectedValueOnce(new Error('Session unavailable'))
    const report = vi.fn()
    const { native } = await createUpdateTransport(network(), report)
    expect(native).toBe(false)
    expect(report).toHaveBeenCalledTimes(1)
  },
)
it('detects preview releases without private tokens and navigates using a fixed official URL', async () => {
  host.packaged = false
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input, init) => {
    expect(init?.headers).not.toHaveProperty('Authorization')
    return String(input).endsWith('/latest')
      ? new Response(null, { status: 404 })
      : Response.json([entry()])
  })
  const { transport } = await createUpdateTransport(network(fetch), vi.fn())
  expect(await transport.latest()).toEqual({ version: '0.3.0-dev.7', native: false })
  await transport.openRelease('0.3.0-dev.7')
  expect(host.open).toHaveBeenCalledWith(
    'https://github.com/Ethan-decoy/QuestBranch/releases/tag/v0.3.0-dev.7',
  )
})
it('stable clients query the stable release endpoint and HTTP errors remain errors', async () => {
  host.version = '0.3.0'
  host.packaged = false
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(entry('0.4.0')))
  const { transport } = await createUpdateTransport(network(fetch), vi.fn())
  expect(await transport.latest()).toEqual({ version: '0.4.0', native: false })
  expect(fetch.mock.calls[0][0]).toBe(
    'https://api.github.com/repos/Ethan-decoy/QuestBranch/releases/latest',
  )
  fetch.mockResolvedValue(new Response(null, { status: 403 }))
  await expect(transport.latest()).rejects.toMatchObject({ code: 'HTTP_403' })
})
