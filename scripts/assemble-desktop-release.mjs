import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verifyUpdateAssets } from './update-release-assets.mjs'

const version = JSON.parse(readFileSync('package.json')).version
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const expectedAssets = {
  'windows-x64': [`QuestBranch-Setup-${version}-x64.exe`, `QuestBranch-${version}-windows-x64.zip`],
  'macos-arm64': [`QuestBranch-${version}-macos-arm64.dmg`],
  'macos-x64': [`QuestBranch-${version}-macos-x64.dmg`],
  'linux-x64': [
    `QuestBranch-${version}-linux-amd64.deb`,
    `QuestBranch-${version}-linux-x86_64.AppImage`,
  ],
}
const acceptedHashes = new Map()
const platforms = Object.fromEntries(
  Object.entries(expectedAssets).map(([key, expected]) => {
    const record = JSON.parse(readFileSync(`release/VERIFICATION-${key}.json`, 'utf8'))
    assert.equal(record.version, version)
    assert.equal(record.sourceCommit, commit)
    const run = record.installer?.workflowRun ?? record.workflowRun
    assert.equal(run, process.env.GITHUB_RUN_ID)
    if (key === 'windows-x64') {
      assert.equal(record.installer.freshInstall, true)
      assert.equal(record.installer.installerUpgrade, true)
      assert.equal(record.installer.uninstallPreservesResearch, true)
      assert.equal(record.installer.nativeUpdater.downloadVerifiedBySdk, true)
      assert.equal(record.installer.nativeUpdater.shutdownBySdk, true)
      assert.equal(record.installer.nativeUpdater.relaunched, true)
      assert.equal(record.om.realSdk, true)
      assert.equal(record.om.calls, 1)
      assert.equal(record.package.contentMatchesBuildInputs, true)
    } else {
      assert.equal(record.platform, key)
      for (const field of [
        'fresh',
        'nativeArchitecture',
        'bytesMatch',
        'sameVersionReinstall',
        'savedLocationAndResearchPreserved',
        'uninstallPreservesResearch',
      ])
        assert.equal(record.installation[field], true)
      assert.equal(record.windowsResearchImportAndReopen.sourcesAndVersions, true)
      assert.equal(record.package.contentMatchesBuildInputs, true)
      assert.equal(record.om.realOmSdk, true)
      assert.equal(record.om.calls, 1)
      assert.equal(record.runtime.conversationCases, 14)
      assert.equal(record.runtime.branchingCases, 15)
      assert.equal(record.runtime.lightGraphCases, 12)
      assert.equal(record.runtime.darkGraphCases, 12)
      assert(record.runtime.networkCases > 0)
      assert(record.runtime.oauthCases > 0)
      assert.equal(record.runtime.modelFixtureRuns, 14)
      if (key === 'linux-x64') {
        assert.equal(record.appImage.researchAndReopen, true)
        assert.equal(record.appImage.nativeUpdater.downloadVerifiedBySdk, true)
        assert.equal(record.appImage.nativeUpdater.shutdownBySdk, true)
        assert.equal(record.appImage.nativeUpdater.relaunched, true)
        assert.equal(record.appImage.nativeUpdater.packagedImplementation, true)
        assert.equal(record.appImage.nativeUpdater.failurePreservedExecutable, true)
        assert.equal(record.appImage.nativeUpdater.failedUpdateResearchReopen, true)
        assert.equal(record.appImage.nativeUpdater.retrySameUpdater, true)
        assert.equal(record.appImage.nativeUpdater.normalQuit, true)
        assert.equal(record.appImage.nativeUpdater.launchRequested, true)
      } else assert.equal(record.signing.adHocVerified, true)
    }
    assert.match(record.package.nativeCodexVersion, /0\.160\.1/)
    assert.deepEqual(
      record.assets.map((asset) => asset.name).sort(),
      [...expected].sort(),
      `Acceptance assets differ from the release packages for ${key}`,
    )
    for (const name of expected) {
      const asset = record.assets.find((entry) => entry.name === name)
      const digest = createHash('sha256')
        .update(readFileSync(join('release', name)))
        .digest('hex')
      assert.equal(
        digest,
        asset.sha256,
        `Downloaded candidate differs from accepted bytes: ${name}`,
      )
      acceptedHashes.set(name, digest)
    }
    return [key, record]
  }),
)
const updateAssets = verifyUpdateAssets('release', version)

copyFileSync('docs/desktop-installation.md', 'release/README-TRIAL.md')
copyFileSync('docs/release-notes.md', 'release/RELEASE-NOTES.md')
const record = {
  version,
  sourceCommit: commit,
  workflowRun: process.env.GITHUB_RUN_ID,
  workflow: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  prerelease: true,
  platforms,
  realProviderCalls: 0,
  updates: {
    check: true,
    installAndRestart: ['windows-nsis', 'linux-appimage'],
    manual: ['windows-zip', 'macos-dmg', 'linux-deb'],
  },
}
writeFileSync('release/VERIFICATION.json', JSON.stringify(record, null, 2) + '\n')
const names = [
  ...acceptedHashes.keys(),
  'README-TRIAL.md',
  'RELEASE-NOTES.md',
  'VERIFICATION.json',
  ...updateAssets,
]
const lines = names.map((name) => {
  const hash =
    acceptedHashes.get(name) ??
    createHash('sha256')
      .update(readFileSync(join('release', name)))
      .digest('hex')
  return `${hash}  ${name}`
})
writeFileSync('release/SHA256SUMS.txt', lines.join('\n') + '\n')
console.log(`Four native targets accepted; ${names.length + 1} release files verified.`)
