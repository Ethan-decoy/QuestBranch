import { app } from 'electron'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { desktopPackage } from './desktop-package.mjs'

// Real Electron transport + upstream updater, synthetic bytes, isolated cache.
// This never invokes an installer, relaunches QB or uses a user's research/profile.
mkdirSync(resolve('artifacts/desktop-updates'), { recursive: true })
const folder = mkdtempSync(resolve('artifacts/desktop-updates/sdk-'))
const profile = join(folder, 'profile')
mkdirSync(profile)
app.setPath('userData', profile)
app.disableHardwareAcceleration()
const packageRoot = process.argv.find((arg) => arg.startsWith('--package-root='))?.slice(15)
const root = packageRoot ? desktopPackage(packageRoot).archive : resolve('.')
const require = createRequire(join(root, 'package.json'))
const { NsisUpdater, AppImageUpdater } = require('electron-updater')
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor')
assert.equal(require('electron-updater/package.json').version, '6.8.12')
const payload = Buffer.from('Synthetic update payload. This is not an executable.\n'.repeat(8192))
const hash = createHash('sha512').update(payload).digest('base64')
let tampered = false
const requests = []
const server = createServer((request, response) => {
  requests.push(request.url)
  if (request.url.includes('.yml')) {
    const name = request.url.includes('-linux') ? 'fixture.AppImage' : 'fixture.exe'
    response.end(
      JSON.stringify({
        version: '1.0.0-dev.2',
        files: [{ url: name, sha512: tampered ? 'A'.repeat(88) : hash, size: payload.length }],
        path: name,
        sha512: hash,
        releaseDate: new Date().toISOString(),
      }),
    )
  } else {
    response.setHeader('content-length', payload.length)
    response.end(payload)
  }
})
const cases = []
const previousImage = process.env.APPIMAGE
async function verify() {
  try {
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    // Route a reserved hostname through a local proxy; no internet request is made.
    const address = server.address()
    for (const [name, Updater, bad] of [
      ['nsis-download-and-cache', NsisUpdater, false],
      ['checksum-rejection', NsisUpdater, true],
      ['appimage-download-and-cache', AppImageUpdater, false],
    ]) {
      tampered = bad
      const cache = join(folder, name)
      mkdirSync(cache)
      const config = join(cache, 'app-update.yml')
      writeFileSync(config, JSON.stringify({ updaterCacheDirName: name }))
      const currentImage = join(cache, 'current.AppImage')
      writeFileSync(currentImage, 'synthetic current image')
      process.env.APPIMAGE = currentImage
      const adapter = {
        version: '1.0.0-dev.1',
        name: 'QuestBranchUpdateFixture',
        isPackaged: true,
        appUpdateConfigPath: config,
        userDataPath: cache,
        baseCachePath: cache,
        whenReady: () => Promise.resolve(),
        relaunch: () => {
          throw new Error('Fixture must never relaunch')
        },
        quit: () => {
          throw new Error('Fixture must never install or quit the application')
        },
        onQuit: () => {
          throw new Error('Automatic installation on quit must be disabled')
        },
      }
      const options = { provider: 'generic', url: 'http://update.qb.invalid/', channel: 'dev' }
      const updater = new Updater(undefined, adapter)
      updater.httpExecutor = new ElectronHttpExecutor()
      updater._testOnlyOptions = { platform: Updater === AppImageUpdater ? 'linux' : 'win32' }
      updater.setFeedURL(options)
      updater.logger = null
      updater.autoDownload = false
      updater.autoInstallOnAppQuit = false
      updater.disableDifferentialDownload = true
      updater.disableWebInstaller = true
      updater.allowDowngrade = false
      await updater.netSession.setProxy({ proxyRules: `http=127.0.0.1:${address.port}` })
      const result = await updater.checkForUpdates()
      assert.equal(result.isUpdateAvailable, true)
      assert.equal(result.downloadPromise, null)
      if (bad) {
        await assert.rejects(updater.downloadUpdate(), /checksum|sha512/i)
      } else {
        const paths = await updater.downloadUpdate()
        assert.equal(paths.length, 1)
        assert.deepEqual(readFileSync(paths[0]), payload)
      }
      cases.push(name)
    }
    assert(requests.some((url) => url.startsWith('http://update.qb.invalid/')))
    const record = {
      version: require('./package.json').version,
      realSdk: true,
      updaterVersion: '6.8.12',
      realElectronProxyTransport: true,
      localFixtureOnly: true,
      installerExecuted: false,
      cases,
    }
    writeFileSync(join(folder, 'verification.json'), JSON.stringify(record, null, 2) + '\n')
    if (process.env.GITHUB_ACTIONS === 'true') {
      mkdirSync(resolve('artifacts/release-evidence'), { recursive: true })
      writeFileSync(
        resolve('artifacts/release-evidence/update-sdk.json'),
        JSON.stringify(record, null, 2) + '\n',
      )
    }
    console.log(JSON.stringify({ folder, ...record }))
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    if (previousImage === undefined) delete process.env.APPIMAGE
    else process.env.APPIMAGE = previousImage
    await new Promise((done) => server.close(done))
    app.exit(process.exitCode ?? 0)
  }
}
void app.whenReady().then(verify)
