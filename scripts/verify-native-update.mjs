import { app } from 'electron'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import fs from 'node:fs'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { desktopPackage, option } from './desktop-package.mjs'
import { updateAssetNames } from './update-release-assets.mjs'

// Exercise the packaged installation implementation against a real released predecessor.
// The parent then checks the actual relaunched candidate window and open research library.
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
const { NsisUpdater } = require('electron-updater')
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
  join(
    dirname(installer),
    updateAssetNames(targetVersion)[process.platform === 'win32' ? 'windows' : 'linux'][0],
  ),
)
let record = {
  fromVersion: previousVersion,
  toVersion: targetVersion,
  driver:
    process.platform === 'linux'
      ? 'packaged QuestBranch AtomicAppImageUpdater'
      : 'packaged NSIS SDK with a released predecessor',
  predecessorUpdaterUi: false,
  fixtureFeed: true,
  installRequested: false,
  shutdownBySdk: false,
}
const result = join(evidence, `native-update-${process.platform}.json`)
app.on('before-quit', () => {
  record = { ...record, normalQuit: true }
  writeFileSync(result, JSON.stringify(record, null, 2) + '\n')
})
if (process.platform === 'linux') {
  const relaunch = app.relaunch.bind(app)
  app.relaunch = (options) => {
    const accepted = relaunch(options)
    record = { ...record, relaunchOptions: options, relaunchAccepted: accepted }
    return accepted
  }
}
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
        server.close(() => app.quit())
      },
    }
    const Updater =
      process.platform === 'win32'
        ? NsisUpdater
        : (await import(pathToFileURL(join(root, 'out/main/update-transport.js')).href))
            .AtomicAppImageUpdater
    assert.equal(typeof Updater, 'function')
    const updater = new Updater(undefined, adapter)
    updater.httpExecutor = new ElectronHttpExecutor()
    updater.logger = null
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.autoRunAppAfterInstall = true
    updater.allowDowngrade = false
    updater.disableDifferentialDownload = true
    updater.disableWebInstaller = true
    let injectingFailure = false
    let installFailure
    updater.on('error', (error) => {
      if (injectingFailure && error.code === 'ENOSPC') installFailure = error
      else fail(error)
    })
    await updater.netSession.setProxy({ mode: 'direct' })
    updater.setFeedURL({
      provider: 'generic',
      channel: process.platform === 'linux' ? 'dev-safe' : 'dev',
      url: `http://127.0.0.1:${server.address().port}/`,
    })
    const update = await updater.checkForUpdates()
    assert.equal(update.isUpdateAvailable, true)
    assert.equal(update.updateInfo.version, targetVersion)
    const files = await updater.downloadUpdate()
    assert.equal(files.length, 1)
    record = { ...record, downloadVerifiedBySdk: true }
    if (process.platform === 'linux') {
      const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
      const previousDigest = digest(oldRoot)
      const replacementDigest = digest(installer)
      const rename = fs.renameSync
      injectingFailure = true
      fs.renameSync = (source, destination) => {
        if (destination === oldRoot)
          throw Object.assign(new Error('Injected replacement failure'), { code: 'ENOSPC' })
        return rename(source, destination)
      }
      syncBuiltinESMExports()
      try {
        await updater.installInPlace(oldRoot)
      } finally {
        fs.renameSync = rename
        syncBuiltinESMExports()
        injectingFailure = false
      }
      assert.equal(installFailure?.code, 'ENOSPC')
      assert.equal(
        digest(oldRoot),
        previousDigest,
        'Failed replacement changed the installed image',
      )
      assert.equal(record.shutdownBySdk, false, 'Failed replacement quit the running application')
      const node = option('node-executable')
      const reopen = option('reopen')
      assert(node && isAbsolute(node), 'Missing acceptance Node executable')
      assert(
        reopen && resolve(reopen).startsWith(resolve('artifacts') + sep),
        'Invalid research fixture',
      )
      const environment = { ...process.env }
      delete environment.ELECTRON_RUN_AS_NODE
      const output = execFileSync(
        node,
        [
          'scripts/verify-branching-mcp.mjs',
          `--package-root=${desktopPackage().root}`,
          `--executable=${oldRoot}`,
          `--reopen=${reopen}`,
        ],
        { encoding: 'utf8', env: environment, timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
      )
      const reopened = JSON.parse(output.trim().split('\n').at(-1))
      assert.equal(
        reopened.success,
        true,
        'The predecessor did not reopen after replacement failure',
      )
      assert.equal(digest(oldRoot), previousDigest)
      record = {
        ...record,
        packagedImplementation: true,
        failurePreservedExecutable: true,
        failedUpdateResearchReopen: true,
        failureReopenFolder: reopened.folder,
        installRequested: true,
      }
      await updater.installInPlace(oldRoot)
      assert.equal(
        digest(oldRoot),
        replacementDigest,
        'Retried replacement differs from the accepted bytes',
      )
      record = { ...record, retrySameUpdater: true }
    } else {
      record = { ...record, installRequested: true }
      updater.quitAndInstall(true, true)
    }
    writeFileSync(result, JSON.stringify(record, null, 2) + '\n')
  })
  .catch(fail)
