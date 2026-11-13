import { expect, it } from 'vitest'
import {
  retiredInstallerAssets,
  selectPreviousRelease,
} from '../scripts/desktop-release-catalog.mjs'

function release(version: string, draft = false) {
  const names = [
    `QuestBranch-${version}-windows-x64.zip`,
    `QuestBranch-Setup-${version}-x64.exe`,
    `QuestBranch-${version}-linux-x86_64.AppImage`,
    `QuestBranch-${version}-macos-arm64.dmg`,
    `QuestBranch-${version}-macos-x64.dmg`,
    `QuestBranch-${version}-linux-amd64.deb`,
    `QuestBranch-Setup-${version}-x64.exe.blockmap`,
    'dev.yml',
    'dev-safe-linux.yml',
    'SHA256SUMS.txt',
    'VERIFICATION.json',
    'RELEASE-NOTES.md',
    'source.zip',
  ]
  return {
    id: 1,
    tag_name: `v${version}`,
    target_commitish: 'a'.repeat(40),
    draft,
    assets: names.map((name, id) => ({
      id,
      name,
      digest: `sha256:${'b'.repeat(64)}`,
      browser_download_url: `https://github.com/Ethan-decoy/QuestBranch/releases/download/v${version}/${name}`,
    })),
  }
}

it('selects the newest downloadable predecessor regardless of API order and excludes drafts and newer versions', () => {
  const result = selectPreviousRelease(
    [
      release('0.3.0-dev.7'),
      release('0.3.0-dev.10'),
      release('0.3.0-dev.9', true),
      release('0.3.0-dev.8'),
    ],
    '0.3.0-dev.9',
  )
  expect(result.version).toBe('0.3.0-dev.8')
  expect(result.sourceCommit).toBe('a'.repeat(40))
  expect(result.assets.installer.sha256).toBe('b'.repeat(64))
})
it('skips retired releases and fails when no downloadable predecessor remains', () => {
  const retired = release('0.3.0-dev.8')
  retired.assets = retired.assets.filter((asset) => asset.name.endsWith('.json'))
  expect(selectPreviousRelease([retired, release('0.3.0-dev.7')], '0.3.0-dev.9').version).toBe(
    '0.3.0-dev.7',
  )
  expect(() => selectPreviousRelease([retired], '0.3.0-dev.9')).toThrow(/No downloadable/)
})
it('refuses unverified predecessor bytes or download locations rather than falling back silently', () => {
  const candidate = release('0.3.0-dev.8')
  candidate.assets[0].digest = ''
  expect(() => selectPreviousRelease([candidate, release('0.3.0-dev.7')], '0.3.0-dev.9')).toThrow(
    /checksum/,
  )
  candidate.assets[0].digest = `sha256:${'b'.repeat(64)}`
  candidate.assets[0].browser_download_url = 'https://example.com/installer.zip'
  expect(() => selectPreviousRelease([candidate], '0.3.0-dev.9')).toThrow(/download URL/)
})
it('limits retirement to older installers and feeds while preserving source, records, current, newer and draft releases', () => {
  const plan: { tag_name: string; assets: { name: string }[] }[] = retiredInstallerAssets(
    [
      release('0.3.0-dev.8'),
      release('0.3.0-dev.9'),
      release('0.3.0-dev.10'),
      release('0.3.0-dev.7', true),
    ],
    '0.3.0-dev.9',
    '0.3.0-dev.9',
  )
  expect(plan.map((item) => item.tag_name)).toEqual(['v0.3.0-dev.8'])
  expect(plan[0].assets).toHaveLength(9)
  expect(
    plan[0].assets.some((asset) => /\.json$|\.md$|source\.zip|SHA256SUMS/.test(asset.name)),
  ).toBe(false)
  expect(() => retiredInstallerAssets([], '0.3.0-dev.10', '0.3.0-dev.9')).toThrow()
})
