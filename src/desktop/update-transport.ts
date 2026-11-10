import { app, shell } from 'electron'
import { accessSync, constants, existsSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import updaterPackage, { type AppUpdater } from 'electron-updater'
import type { Network } from './network'
import {
  releaseApi,
  releaseRepository,
  selectRelease,
  updateChannel,
  type UpdateTransport,
} from './app-updates'

export function supportsNativeUpdate(platform: string, packaged: boolean, installed: boolean) {
  return packaged && installed && (platform === 'win32' || platform === 'linux')
}

export function isAppImageMount(
  image: string | undefined,
  mount: string | undefined,
  executable: string,
) {
  if (!image || !mount) return false
  const path = relative(resolve(mount), resolve(executable))
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

function writableAppImage() {
  if (!isAppImageMount(process.env.APPIMAGE, process.env.APPDIR, process.execPath)) return false
  try {
    accessSync(process.env.APPIMAGE!, constants.W_OK)
    accessSync(dirname(process.env.APPIMAGE!), constants.W_OK)
    return true
  } catch {
    return false
  }
}

export async function createUpdateTransport(
  network: Network,
  installError: (error: Error) => void,
): Promise<{ transport: UpdateTransport; native: boolean }> {
  const version = app.getVersion()
  const channel = updateChannel(version)
  let native = supportsNativeUpdate(
    process.platform,
    app.isPackaged,
    process.platform === 'win32'
      ? existsSync(join(dirname(process.execPath), 'Uninstall QuestBranch.exe'))
      : writableAppImage(),
  )
  let updater: AppUpdater | undefined
  try {
    updater = native ? updaterPackage.autoUpdater : undefined
    if (
      process.platform === 'linux' &&
      updater &&
      !(updater instanceof updaterPackage.AppImageUpdater)
    ) {
      // Package-manager installations must stay manual even if a parent passed APPIMAGE.
      updater = undefined
      native = false
    }
    if (updater) {
      updater.autoDownload = false
      updater.autoInstallOnAppQuit = false
      updater.autoRunAppAfterInstall = true
      updater.allowPrerelease = channel !== 'latest'
      updater.allowDowngrade = false
      updater.disableWebInstaller = true
      // No account cookies or credentials; use the OS proxy just like model requests.
      await updater.netSession.setProxy({ mode: 'system' })
      updater.logger = null
      updater.on('error', (error) => installError(error))
    }
  } catch (error) {
    // An optional updater must never prevent opening a local research library.
    updater = undefined
    native = false
    installError(error instanceof Error ? error : new Error('Update initialization failed'))
  }
  const feedSuffix = native ? (process.platform === 'linux' ? '-linux' : '') : undefined
  return {
    native,
    transport: {
      latest: () =>
        network.run({ operation: 'app-update', provider: 'github' }, async () => {
          const fetchRelease = async (suffix: string) => {
            const response = await network.fetch(`${releaseApi}${suffix}`, {
              headers: {
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
              },
              signal: AbortSignal.timeout(30_000),
            })
            if (response.status === 404 && suffix === '/latest') return null
            if (!response.ok)
              throw Object.assign(new Error('Release discovery failed'), {
                code: `HTTP_${response.status}`,
              })
            return response.json()
          }
          if (channel === 'latest') {
            const stable = await fetchRelease('/latest')
            return stable ? selectRelease([stable], version, feedSuffix) : null
          }
          const [catalog, stable] = await Promise.all([
            fetchRelease('?per_page=100'),
            fetchRelease('/latest'),
          ])
          if (!Array.isArray(catalog)) throw new Error('Invalid release catalog')
          return selectRelease(stable ? [...catalog, stable] : catalog, version, feedSuffix)
        }),
      async download(release, progress) {
        if (!updater || !release.native) throw new Error('Native updating is unavailable')
        // Pin the SDK to the selected release. A newer channel release cannot change this download.
        updater.setFeedURL({
          provider: 'generic',
          url: `${releaseRepository}/releases/download/v${release.version}/`,
          channel: updateChannel(release.version),
          useMultipleRangeRequest: false,
        })
        updater.allowDowngrade = false
        const result = await updater.checkForUpdates()
        if (!result?.isUpdateAvailable || result.updateInfo.version !== release.version)
          throw new Error('Update feed differs from the selected release')
        const onProgress = ({ percent }: { percent: number }) => progress(percent)
        updater.on('download-progress', onProgress)
        try {
          await updater.downloadUpdate()
        } finally {
          updater.removeListener('download-progress', onProgress)
        }
      },
      install() {
        if (!updater) throw new Error('Native updating is unavailable')
        updater.quitAndInstall(true, true)
      },
      openRelease: (target) =>
        shell.openExternal(
          target ? `${releaseRepository}/releases/tag/v${target}` : `${releaseRepository}/releases`,
        ),
    },
  }
}
