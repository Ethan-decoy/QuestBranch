import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Network } from '../src/desktop/network'

const host = vi.hoisted(() => ({
  packaged: true,
  installed: true,
  version: '0.3.0-dev.6',
  open: vi.fn(),
}))
vi.mock('electron', () => ({
  app: {
    getVersion: () => host.version,
    get isPackaged() {
      return host.packaged
    },
  },
  shell: { openExternal: host.open },
}))
vi.mock('node:fs', () => ({
  existsSync: () => host.installed,
  accessSync: () => {},
  constants: { W_OK: 2 },
}))
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
vi.mock('electron-updater', () => ({
  default: {
    get autoUpdater() {
      return sdk
    },
  },
}))
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
