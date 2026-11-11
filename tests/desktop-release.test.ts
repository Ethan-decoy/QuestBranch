import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { afterEach, expect, it } from 'vitest'

const script = resolve('scripts/assemble-desktop-release.mjs')
const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) {
    const target = resolve(folder)
    if (
      !target.startsWith(resolve(tmpdir()) + sep) ||
      !basename(target).startsWith('qb-desktop-release-')
    )
      throw new Error('Unexpected release test cleanup path')
    rmSync(target, { recursive: true, force: true })
  }
})
function candidate() {
  const folder = mkdtempSync(join(tmpdir(), 'qb-desktop-release-'))
  folders.push(folder)
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: folder, stdio: 'pipe' }).toString().trim()
  git('init', '--quiet')
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '--quiet',
    '--allow-empty',
    '-m',
    'fixture',
  )
  const commit = git('rev-parse', 'HEAD')
  mkdirSync(join(folder, 'release'))
  mkdirSync(join(folder, 'docs'))
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ version: '1.0.0-dev.1' }))
  writeFileSync(join(folder, 'docs/desktop-installation.md'), 'Fixture installation')
  writeFileSync(join(folder, 'docs/release-notes.md'), 'Fixture notes')
  const names: Record<string, string[]> = {
    'windows-x64': [
      'QuestBranch-Setup-1.0.0-dev.1-x64.exe',
      'QuestBranch-1.0.0-dev.1-windows-x64.zip',
    ],
    'macos-arm64': ['QuestBranch-1.0.0-dev.1-macos-arm64.dmg'],
    'macos-x64': ['QuestBranch-1.0.0-dev.1-macos-x64.dmg'],
    'linux-x64': [
      'QuestBranch-1.0.0-dev.1-linux-amd64.deb',
      'QuestBranch-1.0.0-dev.1-linux-x86_64.AppImage',
    ],
  }
  const records = Object.fromEntries(
    Object.entries(names).map(([platform, assets]) => [
      platform,
      {
        version: '1.0.0-dev.1',
        sourceCommit: commit,
        workflowRun: '123',
        platform,
        installer:
          platform === 'windows-x64'
            ? {
                workflowRun: '123',
                freshInstall: true,
                installerUpgrade: true,
                uninstallPreservesResearch: true,
                nativeUpdater: {
                  downloadVerifiedBySdk: true,
                  shutdownBySdk: true,
                  relaunched: true,
                },
              }
            : undefined,
        installation: {
          fresh: true,
          nativeArchitecture: true,
          bytesMatch: true,
          sameVersionReinstall: true,
          savedLocationAndResearchPreserved: true,
          uninstallPreservesResearch: true,
        },
        package: { nativeCodexVersion: 'codex-cli 0.160.1', contentMatchesBuildInputs: true },
        om: { realSdk: true, realOmSdk: true, calls: 1 },
        windowsResearchImportAndReopen: { sourcesAndVersions: true },
        runtime: {
          conversationCases: 14,
          branchingCases: 15,
          lightGraphCases: 12,
          darkGraphCases: 12,
          networkCases: 1,
          oauthCases: 1,
          modelFixtureRuns: 14,
        },
        signing: { adHocVerified: true },
        appImage: {
          researchAndReopen: true,
          nativeUpdater: {
            downloadVerifiedBySdk: true,
            shutdownBySdk: true,
            relaunched: true,
            packagedImplementation: true,
            failurePreservedExecutable: true,
            failedUpdateResearchReopen: true,
            retrySameUpdater: true,
          },
        },
        assets: assets.map((name) => {
          writeFileSync(join(folder, 'release', name), name)
          return { name, sha256: createHash('sha256').update(name).digest('hex') }
        }),
      },
    ]),
  )
  for (const [name, payload] of [
    ['dev.yml', 'QuestBranch-Setup-1.0.0-dev.1-x64.exe'],
    ['dev-safe-linux.yml', 'QuestBranch-1.0.0-dev.1-linux-x86_64.AppImage'],
  ]) {
    const bytes = readFileSync(join(folder, 'release', payload))
    const sha512 = createHash('sha512').update(bytes).digest('base64')
    writeFileSync(
      join(folder, 'release', name),
      JSON.stringify({
        version: '1.0.0-dev.1',
        files: [{ url: payload, sha512, size: bytes.length }],
        path: payload,
        sha512,
      }),
    )
  }
  writeFileSync(
    join(folder, 'release/QuestBranch-Setup-1.0.0-dev.1-x64.exe.blockmap'),
    'fixture blockmap',
  )
  return {
    folder,
    records,
    run() {
      for (const [key, record] of Object.entries(records))
        writeFileSync(join(folder, `release/VERIFICATION-${key}.json`), JSON.stringify(record))
      return spawnSync(process.execPath, [script], {
        cwd: folder,
        env: { ...process.env, GITHUB_RUN_ID: '123', GITHUB_REPOSITORY: 'fixture/repository' },
        encoding: 'utf8',
      })
    },
  }
}

it('assembles exactly the accepted four-target bytes and source-bound metadata', () => {
  const c = candidate()
  expect(c.run().status).toBe(0)
  const manifest = readFileSync(join(c.folder, 'release/SHA256SUMS.txt'), 'utf8').trim().split('\n')
  expect(manifest).toHaveLength(12)
  for (const line of manifest) {
    const [hash, name] = line.split('  ')
    expect(
      createHash('sha256')
        .update(readFileSync(join(c.folder, 'release', name)))
        .digest('hex'),
    ).toBe(hash)
  }
})
it.each(['version', 'sourceCommit', 'workflowRun'])('rejects another candidate %s', (field) => {
  const c = candidate()
  Object.assign(c.records['macos-arm64'], { [field]: 'another-candidate' })
  expect(c.run().status).not.toBe(0)
})
it('rejects incomplete native installation evidence', () => {
  const c = candidate()
  Object.assign(c.records['linux-x64'].installation, { fresh: undefined })
  expect(c.run().status).not.toBe(0)
})
it('rejects a download-only check without verified native relaunch', () => {
  const c = candidate()
  c.records['linux-x64'].appImage.nativeUpdater.relaunched = false
  expect(c.run().status).not.toBe(0)
})
it('requires the packaged AppImage implementation, failure recovery and retry acceptance', () => {
  const c = candidate()
  c.records['linux-x64'].appImage.nativeUpdater.failedUpdateResearchReopen = false
  expect(c.run().status).not.toBe(0)
})
it('prepares a safe Linux update feed and removes the legacy native-update entry', () => {
  const c = candidate()
  const legacy = join(c.folder, 'release/dev-linux.yml')
  const safe = join(c.folder, 'release/dev-safe-linux.yml')
  renameSync(safe, legacy)
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/update-release-assets.mjs'), '--prepare-linux'],
    {
      cwd: c.folder,
      encoding: 'utf8',
    },
  )
  expect(result.status, result.stderr).toBe(0)
  expect(existsSync(legacy)).toBe(false)
  expect(existsSync(safe)).toBe(true)
  expect(c.run().status).toBe(0)
})
it('rejects a missing platform and failed runtime checks', () => {
  const c = candidate()
  c.records['macos-x64'].runtime.networkCases = 0
  expect(c.run().status).not.toBe(0)
  delete c.records['macos-x64']
  rmSync(join(c.folder, 'release/VERIFICATION-macos-x64.json'))
  expect(c.run().status).not.toBe(0)
})
it('rejects candidate bytes changed after native acceptance', () => {
  const c = candidate()
  writeFileSync(join(c.folder, 'release', c.records['linux-x64'].assets[0].name), 'changed')
  expect(c.run().status).not.toBe(0)
})
it('rejects a replacement ZIP missing from the Windows acceptance record', () => {
  const c = candidate()
  const zip = c.records['windows-x64'].assets.pop()!
  writeFileSync(join(c.folder, 'release', zip.name), 'unverified replacement')
  const result = c.run()
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('windows-x64')
})
it.each(['duplicate', 'wrong platform'])('rejects %s asset acceptance', (kind) => {
  const c = candidate()
  const mac = c.records['macos-x64'].assets
  if (kind === 'duplicate') mac.push(mac[0])
  else mac[0] = c.records['macos-arm64'].assets[0]
  const result = c.run()
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('macos-x64')
})
it('rejects metadata that redirects to another payload or contains an incorrect update hash', () => {
  const c = candidate()
  const path = join(c.folder, 'release/dev.yml')
  const original = JSON.parse(readFileSync(path, 'utf8'))
  writeFileSync(
    path,
    JSON.stringify({
      ...original,
      files: [{ ...original.files[0], url: 'https://untrusted.invalid/installer.exe' }],
    }),
  )
  expect(c.run().status).not.toBe(0)
  writeFileSync(
    path,
    JSON.stringify({ ...original, files: [{ ...original.files[0], sha512: 'wrong' }] }),
  )
  expect(c.run().status).not.toBe(0)
})
