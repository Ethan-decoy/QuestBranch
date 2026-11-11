import { app, shell } from 'electron'
import { createHash } from 'node:crypto'
import {
  accessSync,
  constants,
  createReadStream,
  existsSync,
  renameSync,
  rmSync,
  rmdirSync,
} from 'node:fs'
import { chmod, copyFile, mkdtemp, open } from 'node:fs/promises'
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
  const image = process.env.APPIMAGE
  if (!image || !isAbsolute(image) || !isAppImageMount(image, process.env.APPDIR, process.execPath))
    return
  try {
    accessSync(image, constants.W_OK)
    accessSync(dirname(image), constants.W_OK)
    return image
  } catch {
    return
  }
}

// Keep the SDK's download and quit lifecycle. Its default AppImage install unlinks the
// running image before moving the download, which can be on a different filesystem.
export class AtomicAppImageUpdater extends updaterPackage.AppImageUpdater {
  private staged?: { path: string; destination: string }

  async installInPlace(destination: string) {
    const installer = this.installerPath
    const sha512 = this.downloadedUpdateHelper?.downloadedFileInfo?.sha512
    if (!installer || !sha512) throw new Error('Missing verified AppImage download')
    const directory = await mkdtemp(join(dirname(destination), '.questbranch-update-'))
    const path = join(directory, 'replacement.AppImage')
    try {
      await copyFile(installer, path, constants.COPYFILE_EXCL)
      const hash = createHash('sha512')
      for await (const chunk of createReadStream(path)) hash.update(chunk)
      if (hash.digest('base64') !== sha512) throw new Error('Staged AppImage digest mismatch')
      await chmod(path, 0o755)
      const file = await open(path, 'r+')
      try {
        await file.sync()
      } finally {
        await file.close()
      }
      this.staged = { path, destination }
      this.quitAndInstall(true, true)
    } finally {
      this.staged = undefined
      try {
        rmSync(path, { force: true })
        rmdirSync(directory)
      } catch {
        // Staging cleanup must not replace the install result.
      }
    }
  }

  protected doInstall() {
    const staged = this.staged
    if (!staged) throw new Error('No verified AppImage staged for installation')
    renameSync(staged.path, staged.destination)
    // Research is closed in before-quit. Release the lock in will-quit before
    // using the SDK's launcher, so the replacement can open its own window.
    app.once('will-quit', () => {
      app.releaseSingleInstanceLock()
      void this.spawnLog(staged.destination, process.argv.slice(1), {
        ...process.env,
        APPIMAGE_SILENT_INSTALL: 'true',
      }).catch((error: Error) => this.dispatchError(error))
    })
    return true
  }
}

export async function createUpdateTransport(
  network: Network,
  installError: (error: Error) => void,
): Promise<{ transport: UpdateTransport; native: boolean }> {
  const version = app.getVersion()
  const channel = updateChannel(version)
  const appImage = process.platform === 'linux' ? writableAppImage() : undefined
  let native = supportsNativeUpdate(
    process.platform,
    app.isPackaged,
    process.platform === 'win32'
      ? existsSync(join(dirname(process.execPath), 'Uninstall QuestBranch.exe'))
      : appImage !== undefined,
  )
  let updater: AppUpdater | undefined
  let appImageUpdater: AtomicAppImageUpdater | undefined
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
    if (updater && appImage) updater = appImageUpdater = new AtomicAppImageUpdater()
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
  const feedSuffix = native ? (process.platform === 'linux' ? '-safe-linux' : '') : undefined
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
          channel: appImage
            ? `${updateChannel(release.version)}-safe`
            : updateChannel(release.version),
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
        if (appImage && appImageUpdater) return appImageUpdater.installInPlace(appImage)
        updater.quitAndInstall(true, true)
      },
      openRelease: (target) =>
        shell.openExternal(
          target ? `${releaseRepository}/releases/tag/v${target}` : `${releaseRepository}/releases`,
        ),
    },
  }
}
