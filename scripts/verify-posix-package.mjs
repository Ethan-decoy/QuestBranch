import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { desktopPackage } from './desktop-package.mjs'

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Use a disposable Actions runner')
assert.equal(process.env.GITHUB_REPOSITORY, 'Ethan-decoy/QuestBranch')
assert(['darwin', 'linux'].includes(process.platform), 'Windows has its NSIS acceptance suite')
const source = resolve('.')
const version = JSON.parse(readFileSync('package.json')).version
const commit = process.env.GITHUB_SHA
const key = `${process.platform === 'darwin' ? 'macos' : 'linux'}-${process.arch}`
const evidence = resolve('artifacts/release-evidence')
const temporary = mkdtempSync(join(process.env.RUNNER_TEMP, 'questbranch-native-'))
mkdirSync(evidence, { recursive: true })
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const json = (path) => JSON.parse(readFileSync(path, 'utf8'))
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'TAVILY_API_KEY', 'CODEX_CONFIG'])
  delete environment[name]

async function run(name, command, args, options = {}) {
  const stdout = [],
    stderr = []
  const child = spawn(command, args, {
    cwd: source,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
  child.stdout.on('data', (chunk) => stdout.push(chunk))
  child.stderr.on('data', (chunk) => stderr.push(chunk))
  const timeout = setTimeout(() => child.kill(), 180000)
  let code
  try {
    code = await new Promise((done, reject) => {
      child.once('exit', done)
      child.once('error', reject)
    })
  } finally {
    clearTimeout(timeout)
    writeFileSync(join(evidence, `${name}.stdout.log`), Buffer.concat(stdout))
    writeFileSync(join(evidence, `${name}.stderr.log`), Buffer.concat(stderr))
  }
  assert.equal(code, 0, `${name} failed: ${Buffer.concat(stderr).toString().slice(-4000)}`)
  console.log(`Passed: ${name}`)
  return { stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }
}

function preserveResult(folder, name) {
  folder = resolve(folder)
  assert(folder.startsWith(join(source, 'artifacts') + sep))
  const resultName = existsSync(join(folder, 'result.json')) ? 'result.json' : 'verified.json'
  const result = existsSync(join(folder, resultName)) ? json(join(folder, resultName)) : null
  const target = join(evidence, name)
  mkdirSync(target)
  for (const file of readdirSync(folder))
    if (file === resultName || file.endsWith('.png') || file === 'failed.txt')
      cpSync(join(folder, file), join(target, file))
  return result
}

async function research(root, name, extra = []) {
  let output
  try {
    output = await run(name, process.execPath, [
      'scripts/verify-branching-mcp.mjs',
      `--package-root=${root}`,
      ...extra,
    ])
  } catch (error) {
    const stdout = readFileSync(join(evidence, `${name}.stdout.log`), 'utf8')
    const folder = stdout.match(/^Verification folder: (.+)$/m)?.[1]
    if (folder) preserveResult(folder.trim(), name)
    throw error
  }
  const result = JSON.parse(output.stdout.trim().split('\n').at(-1))
  assert.equal(result.success, true)
  const details = preserveResult(result.folder, name)
  assert.equal(details.normalExit, true)
  return { folder: result.folder, details }
}

const engine =
  process.platform === 'darwin'
    ? resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : resolve('node_modules/electron/dist/electron')
async function gui(root, script, name, extra = []) {
  let output
  try {
    output = await run(name, engine, [`scripts/${script}.mjs`, `--package-root=${root}`, ...extra])
  } catch (error) {
    const stdout = readFileSync(join(evidence, `${name}.stdout.log`), 'utf8')
    const folder = stdout.match(/^Verification folder: (.+)$/m)?.[1]
    if (folder) preserveResult(folder.trim(), name)
    throw error
  }
  const line = output.stdout.trim().split('\n').at(-1)
  const folder = line.startsWith('{') ? JSON.parse(line).folder : line.match(/: (.+)$/)?.[1]
  assert(folder, `No result folder from ${name}`)
  return preserveResult(folder, name)
}

const built = desktopPackage()
const builtAsar = sha256(built.archive)
const assets =
  process.platform === 'darwin'
    ? [`QuestBranch-${version}-macos-${process.arch}.dmg`]
    : [`QuestBranch-${version}-linux-amd64.deb`, `QuestBranch-${version}-linux-x86_64.AppImage`]
for (const asset of assets)
  assert(existsSync(join('release', asset)), `Missing native asset: ${asset}`)
let installed, signature, fontFamily
if (process.platform === 'darwin') {
  const mount = join(temporary, 'dmg')
  mkdirSync(mount)
  await run('dmg-integrity', 'hdiutil', ['verify', resolve('release', assets[0])])
  await run('dmg-mount', 'hdiutil', [
    'attach',
    '-readonly',
    '-nobrowse',
    '-mountpoint',
    mount,
    resolve('release', assets[0]),
  ])
  installed = join(temporary, '安装验收 QuestBranch/QuestBranch.app')
  try {
    await run('dmg-install', 'ditto', [join(mount, 'QuestBranch.app'), installed])
  } finally {
    await run('dmg-unmount', 'hdiutil', ['detach', mount])
  }
  await run('mac-signature-verify', 'codesign', ['--verify', '--deep', '--strict', installed])
  signature = (
    await run('mac-signature-details', 'codesign', ['--display', '--verbose=4', installed])
  ).stderr
  assert.match(signature, /Signature=adhoc/)
  const arch = (
    await run('mac-architecture', 'lipo', ['-archs', desktopPackage(installed).executable])
  ).stdout.trim()
  assert.equal(arch, process.arch === 'arm64' ? 'arm64' : 'x86_64')
} else {
  await run('deb-install', 'sudo', ['apt-get', 'install', '-y', resolve('release', assets[0])])
  installed = '/opt/QuestBranch'
  fontFamily = (await run('linux-cjk-font', 'fc-match', ['-f', '%{family}', ':lang=zh-cn'])).stdout
  assert.match(fontFamily, /Noto.*CJK/)
  const recommends = (
    await run('deb-font-metadata', 'dpkg-query', ['-W', '-f=${Recommends}', 'questbranch'])
  ).stdout
  assert.match(recommends, /fonts-noto-cjk/)
}
const actual = desktopPackage(installed)
assert.equal(sha256(actual.archive), builtAsar, 'Installed bytes differ from the built package')
for (const [script, name] of [
  ['verify-package-integrity', 'package-runtime'],
  ['verify-session-runtime', 'session-runtime'],
])
  await run(name, actual.executable, [`scripts/${script}.mjs`, `--package-root=${installed}`], {
    env: { ...environment, ELECTRON_RUN_AS_NODE: '1' },
  })

const fresh = await research(installed, 'installed-research')
await run('update-sdk', engine, ['scripts/verify-updates.mjs', `--package-root=${installed}`])
assert.equal(fresh.details.cases.length, 15)
const pointer = join(fresh.folder, 'profile/storage-location.json')
writeFileSync(pointer, JSON.stringify({ version: 1, directory: join(fresh.folder, 'research') }))
const pointerHash = sha256(pointer)
// Reinstall the accepted DMG/DEB; the historical AppImage upgrade is verified separately.
if (process.platform === 'darwin') {
  assert(installed.startsWith(temporary + sep))
  rmSync(installed, { recursive: true })
  await run('mac-reinstall', 'ditto', [built.root, installed])
} else
  await run('deb-reinstall', 'sudo', [
    'apt-get',
    'install',
    '--reinstall',
    '-y',
    resolve('release', assets[0]),
  ])
assert.equal(sha256(actual.archive), builtAsar)
await research(installed, 'reinstalled-reopen', [`--reopen=${fresh.folder}`, '--saved-location'])
assert.equal(sha256(pointer), pointerHash)

const conversation = await gui(installed, 'verify-conversation-actions', 'conversation')
assert.equal(conversation.cases.length, 14)
const graphs = {}
for (const theme of ['light', 'dark']) {
  graphs[theme] = await gui(installed, 'verify-graph-toolbar', `graph-${theme}`, [
    `--theme=${theme}`,
  ])
  assert.equal(graphs[theme].cases.length, 12)
  assert.equal(graphs[theme].issues.length, 0)
}
const network = await gui(installed, 'verify-network', 'network')
const oauth = await gui(installed, 'verify-auth-recovery', 'oauth')
const models = await gui(installed, 'verify-pi-models', 'models', ['--packaged'])
assert.equal(models.completedRuns, 14)
const imported = await research(installed, 'windows-research-import', [
  '--restore=tests/fixtures/portable-research-v3.json',
])
await research(installed, 'windows-research-import-reopen', [`--reopen=${imported.folder}`])

let appImage = null
if (process.platform === 'linux') {
  const image = resolve('release', assets[1])
  const imageStudy = await research(built.root, 'appimage-research', [`--executable=${image}`])
  await research(built.root, 'appimage-reopen', [
    `--executable=${image}`,
    `--reopen=${imageStudy.folder}`,
  ])
  const predecessor = join(temporary, 'QuestBranch-upgrade.AppImage')
  await run('appimage-predecessor', 'curl', [
    '--fail',
    '--location',
    '--retry',
    '2',
    '--output',
    predecessor,
    'https://github.com/Ethan-decoy/QuestBranch/releases/download/v0.3.0-dev.7/QuestBranch-0.3.0-dev.7-linux-x86_64.AppImage',
  ])
  assert.equal(
    sha256(predecessor),
    'b8a4c05173f06638920462ba7fdfe28724bd817cd7e02aacf589f37bc76e476b',
  )
  chmodSync(predecessor, 0o755)
  const data = join(imageStudy.folder, 'research')
  await run(
    'native-update',
    engine,
    [
      'scripts/verify-native-update.mjs',
      `--previous-root=${predecessor}`,
      `--installer=${image}`,
      '--previous-version=0.3.0-dev.7',
      `--node-executable=${process.execPath}`,
      `--reopen=${imageStudy.folder}`,
    ],
    {
      env: { ...environment, QUESTBRANCH_DATA_DIR: data },
    },
  )
  assert.equal(
    sha256(predecessor),
    sha256(image),
    'AppImage replacement differs from accepted bytes',
  )
  let relaunchedPid
  let windowChecks = []
  const deadline = Date.now() + 60_000
  while (!relaunchedPid && Date.now() < deadline) {
    windowChecks = []
    try {
      const windows = execFileSync(
        'xdotool',
        ['search', '--onlyvisible', '--name', '^QuestBranch'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      )
        .trim()
        .split('\n')
      for (const window of windows) {
        const pid = Number(
          execFileSync('xdotool', ['getwindowpid', window], { encoding: 'utf8' }).trim(),
        )
        const executable = readlinkSync(`/proc/${pid}/exe`)
        const archive = join(dirname(executable), 'resources/app.asar')
        const database = realpathSync(join(data, 'research.sqlite'))
        const databaseOpen = readdirSync(`/proc/${pid}/fd`).some((descriptor) => {
          try {
            return readlinkSync(`/proc/${pid}/fd/${descriptor}`) === database
          } catch {
            return false // A descriptor may close while the process remains live.
          }
        })
        const acceptedBytes = databaseOpen && existsSync(archive) && sha256(archive) === builtAsar
        windowChecks.push({
          window,
          pid,
          executable,
          archive,
          acceptedBytes,
          database,
          databaseOpen,
        })
        // Check the running application's actual bytes and open data, rather than
        // relying on environment entries remaining readable through /proc.
        if (acceptedBytes) {
          relaunchedPid = pid
          break
        }
      }
    } catch (error) {
      windowChecks.push({ error: String(error.message) })
    }
    if (!relaunchedPid) await new Promise((done) => setTimeout(done, 200))
  }
  writeFileSync(
    join(evidence, 'native-update-window-diagnostics.json'),
    JSON.stringify(
      { expectedImage: predecessor, expectedData: data, windows: windowChecks },
      null,
      2,
    ) + '\n',
  )
  assert(relaunchedPid, 'Updated AppImage did not relaunch its research window')
  const nativeUpdate = json(join(evidence, 'native-update-linux.json'))
  assert.equal(nativeUpdate.installRequested, true)
  assert.equal(nativeUpdate.shutdownBySdk, true)
  assert.equal(nativeUpdate.downloadVerifiedBySdk, true)
  assert.equal(nativeUpdate.packagedImplementation, true)
  assert.equal(nativeUpdate.failurePreservedExecutable, true)
  assert.equal(nativeUpdate.failedUpdateResearchReopen, true)
  assert.equal(nativeUpdate.retrySameUpdater, true)
  assert.equal(
    preserveResult(nativeUpdate.failureReopenFolder, 'appimage-failed-update-reopen').normalExit,
    true,
  )
  nativeUpdate.relaunched = true
  nativeUpdate.cleanup =
    'SIGTERM after verifying the new window, accepted ASAR and open isolated database'
  writeFileSync(
    join(evidence, 'native-update-linux.json'),
    JSON.stringify(nativeUpdate, null, 2) + '\n',
  )
  process.kill(relaunchedPid, 'SIGTERM')
  await new Promise((done) => setTimeout(done, 1000))
  await research(built.root, 'appimage-updated-reopen', [
    `--executable=${predecessor}`,
    `--reopen=${imageStudy.folder}`,
  ])
  appImage = { realLauncher: true, researchAndReopen: true, nativeUpdater: nativeUpdate }
  await run('deb-uninstall', 'sudo', ['apt-get', 'remove', '-y', 'questbranch'])
  assert(!existsSync(actual.executable))
} else {
  assert(installed.startsWith(temporary + sep))
  rmSync(installed, { recursive: true })
  assert(!existsSync(installed))
}
assert(existsSync(join(fresh.folder, 'research/research.sqlite')))
assert.equal(sha256(pointer), pointerHash)

const record = {
  version,
  sourceCommit: commit,
  platform: key,
  workflowRun: process.env.GITHUB_RUN_ID,
  fixtureOnly: true,
  realProviderCalls: 0,
  installation: {
    fresh: true,
    nativeArchitecture: true,
    bytesMatch: true,
    sameVersionReinstall: true,
    savedLocationAndResearchPreserved: true,
    uninstallPreservesResearch: true,
  },
  windowsResearchImportAndReopen: imported.details.restored,
  runtime: {
    conversationCases: conversation.cases.length,
    branchingCases: fresh.details.cases.length,
    lightGraphCases: graphs.light.cases.length,
    darkGraphCases: graphs.dark.cases.length,
    networkCases: network.cases.length,
    oauthCases: oauth.cases.length,
    modelFixtureRuns: models.completedRuns,
  },
  package: json(join(evidence, 'package-integrity.json')),
  om: (() => {
    const sdk = JSON.parse(readFileSync(join(evidence, 'session-runtime.stdout.log'), 'utf8'))
    return { realOmSdk: sdk.realOmSdk, calls: sdk.calls, identity: sdk.identity, fixtureOnly: true }
  })(),
  credentialStorage: models.credentialStorage,
  fontFamily,
  signing:
    process.platform === 'darwin'
      ? { adHocVerified: true, developerId: false, notarized: false }
      : { signed: false },
  appImage,
  automaticInstallOnQuit: false,
  assets: assets.map((name) => ({ name, sha256: sha256(join('release', name)) })),
}
writeFileSync(join('release', `VERIFICATION-${key}.json`), JSON.stringify(record, null, 2) + '\n')
console.log(`Native package acceptance completed: ${key}`)
