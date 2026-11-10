import { app } from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { desktopPackage, option } from './desktop-package.mjs'

// A current SDK drives the real released predecessor's installer/image to the
// accepted candidate, then the parent verifies the actual new application's launch.
// This is an external acceptance driver: published dev.6 has no updater UI.
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Use a disposable Actions runner')
assert.equal(process.env.GITHUB_REPOSITORY, 'Ethan-decoy/QuestBranch')
assert(['win32', 'linux'].includes(process.platform))
const temporary = resolve(process.env.RUNNER_TEMP)
const oldRoot = resolve(option('previous-root'))
const installer = resolve(option('installer'))
const previousVersion = option('previous-version')
const targetVersion = JSON.parse(readFileSync('package.json', 'utf8')).version
assert(oldRoot.startsWith(temporary + sep), 'Predecessor leaves the disposable test root')
const evidence = resolve('artifacts/release-evidence')
mkdirSync(evidence, { recursive: true })
const folder = mkdtempSync(join(temporary, 'qb-native-update-'))
const config = join(folder, 'app-update.yml')
writeFileSync(config, JSON.stringify({ updaterCacheDirName: 'native-update-acceptance' }))
app.setPath('userData', folder)
app.disableHardwareAcceleration()
const root = desktopPackage().archive
const require = createRequire(join(root, 'package.json'))
const { NsisUpdater, AppImageUpdater } = require('electron-updater')
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor')
assert.equal(require('electron-updater/package.json').version, '6.8.12')
if (process.platform === 'win32') {
  assert(existsSync(join(oldRoot, 'Uninstall QuestBranch.exe')))
  assert.equal(
    JSON.parse(readFileSync(join(oldRoot, 'resources/app.asar/package.json'))).version,
    previousVersion,
  )
} else {
  assert(existsSync(oldRoot))
  process.env.APPIMAGE = oldRoot
}
const feed = readFileSync(
  join(dirname(installer), process.platform === 'win32' ? 'dev.yml' : 'dev-linux.yml'),
)
let record = {
  fromVersion: previousVersion,
  toVersion: targetVersion,
  driver: 'current packaged SDK with a released predecessor',
  predecessorUpdaterUi: false,
  fixtureFeed: true,
  installRequested: false,
  shutdownBySdk: false,
}
const result = join(evidence, `native-update-${process.platform}.json`)
const server = createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname.slice(1))
  if (name.endsWith('.yml')) response.end(feed)
  else if (name === basename(installer)) {
    response.setHeader('Content-Length', statSync(installer).size)
    createReadStream(installer).pipe(response)
  } else response.writeHead(404).end()
})
function fail(error) {
  console.error(error)
  writeFileSync(result, JSON.stringify({ ...record, failed: true }, null, 2))
  server.closeAllConnections()
  server.close()
  app.exit(1)
}
void app
  .whenReady()
  .then(async () => {
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    const adapter = {
      version: previousVersion,
      name: 'QuestBranch',
      isPackaged: true,
      appUpdateConfigPath: config,
      userDataPath: folder,
      baseCachePath: folder,
      whenReady: () => Promise.resolve(),
      relaunch: () => {
        throw new Error('SDK must use the native installer')
      },
      onQuit: () => {
        throw new Error('Installation on normal quit must stay disabled')
      },
      quit: () => {
        record = { ...record, shutdownBySdk: true }
        writeFileSync(result, JSON.stringify(record, null, 2) + '\n')
        console.log(JSON.stringify(record))
        server.closeAllConnections()
        server.close(() => app.exit(0))
      },
    }
    const Updater = process.platform === 'win32' ? NsisUpdater : AppImageUpdater
    const updater = new Updater(undefined, adapter)
    updater.httpExecutor = new ElectronHttpExecutor()
    updater.logger = null
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.autoRunAppAfterInstall = true
    updater.allowDowngrade = false
    updater.disableDifferentialDownload = true
    updater.disableWebInstaller = true
    updater.on('error', fail)
    await updater.netSession.setProxy({ mode: 'direct' })
    updater.setFeedURL({
      provider: 'generic',
      channel: 'dev',
      url: `http://127.0.0.1:${server.address().port}/`,
    })
    const update = await updater.checkForUpdates()
    assert.equal(update.isUpdateAvailable, true)
    assert.equal(update.updateInfo.version, targetVersion)
    const files = await updater.downloadUpdate()
    assert.equal(files.length, 1)
    record = { ...record, downloadVerifiedBySdk: true, installRequested: true }
    writeFileSync(result, JSON.stringify(record, null, 2) + '\n')
    updater.quitAndInstall(true, true)
  })
  .catch(fail)
