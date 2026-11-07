import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const version = JSON.parse(readFileSync('package.json')).version
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const keys = ['windows-x64', 'macos-arm64', 'macos-x64', 'linux-x64']
const platforms = Object.fromEntries(
  keys.map((key) => {
    const record = JSON.parse(readFileSync(`release/VERIFICATION-${key}.json`, 'utf8'))
    assert.equal(record.version, version)
    assert.equal(record.sourceCommit, commit)
    const run = record.installer?.workflowRun ?? record.workflowRun
    assert.equal(run, process.env.GITHUB_RUN_ID)
    if (key === 'windows-x64') {
      assert.equal(record.installer.freshInstall, true)
      assert.equal(record.installer.installerUpgrade, true)
      assert.equal(record.installer.uninstallPreservesResearch, true)
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
      if (key === 'linux-x64') assert.equal(record.appImage.researchAndReopen, true)
      else assert.equal(record.signing.adHocVerified, true)
    }
    assert.match(record.package.nativeCodexVersion, /0\.160\.1/)
    assert(record.assets.length > 0)
    for (const asset of record.assets) {
      assert.match(asset.name, /^[A-Za-z0-9_.-]+$/)
      const digest = createHash('sha256')
        .update(readFileSync(join('release', asset.name)))
        .digest('hex')
      assert.equal(
        digest,
        asset.sha256,
        `Downloaded candidate differs from accepted bytes: ${asset.name}`,
      )
    }
    return [key, record]
  }),
)

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
  automaticUpdatesProvided: false,
}
writeFileSync('release/VERIFICATION.json', JSON.stringify(record, null, 2) + '\n')
const names = [
  `QuestBranch-Setup-${version}-x64.exe`,
  `QuestBranch-${version}-windows-x64.zip`,
  `QuestBranch-${version}-macos-arm64.dmg`,
  `QuestBranch-${version}-macos-x64.dmg`,
  `QuestBranch-${version}-linux-amd64.deb`,
  `QuestBranch-${version}-linux-x86_64.AppImage`,
  'README-TRIAL.md',
  'RELEASE-NOTES.md',
  'VERIFICATION.json',
]
const lines = names.map((name) => {
  const bytes = readFileSync(join('release', name))
  return `${createHash('sha256').update(bytes).digest('hex')}  ${name}`
})
writeFileSync('release/SHA256SUMS.txt', lines.join('\n') + '\n')
console.log(`Four native targets accepted; ${names.length + 1} release files verified.`)
