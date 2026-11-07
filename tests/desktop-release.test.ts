import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'

const script = resolve('scripts/assemble-desktop-release.mjs')
const folders: string[] = []
afterEach(() =>
  folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true })),
)
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
      'QuestBranch-1.0.0-dev.1-linux-x64.deb',
      'QuestBranch-1.0.0-dev.1-linux-x64.AppImage',
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
        appImage: { researchAndReopen: true },
        assets: assets.map((name) => {
          writeFileSync(join(folder, 'release', name), name)
          return { name, sha256: createHash('sha256').update(name).digest('hex') }
        }),
      },
    ]),
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
  expect(manifest).toHaveLength(9)
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
