import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import semver from 'semver'

export const releaseRepository = 'Ethan-decoy/QuestBranch'

function versionOf(release) {
  return !release.draft && semver.valid(release.tag_name?.replace(/^v/, ''))
}

function packageNames(version) {
  return {
    zip: `QuestBranch-${version}-windows-x64.zip`,
    installer: `QuestBranch-Setup-${version}-x64.exe`,
    appImage: `QuestBranch-${version}-linux-x86_64.AppImage`,
    deb: `QuestBranch-${version}-linux-amd64.deb`,
    armMac: `QuestBranch-${version}-macos-arm64.dmg`,
    intelMac: `QuestBranch-${version}-macos-x64.dmg`,
  }
}

export function selectPreviousRelease(releases, current) {
  assert(semver.valid(current), 'Invalid candidate version')
  const candidates = releases
    .filter((release) => {
      const version = versionOf(release)
      return (
        version &&
        semver.lt(version, current) &&
        ['zip', 'installer', 'appImage'].every((kind) =>
          release.assets.some((asset) => asset.name === packageNames(version)[kind]),
        )
      )
    })
    .sort((a, b) => semver.rcompare(versionOf(a), versionOf(b)))
  const release = candidates[0]
  assert(release, 'No downloadable published predecessor is available')
  const version = versionOf(release)
  assert.match(release.target_commitish, /^[a-f0-9]{40}$/, 'Predecessor source must be pinned')
  const assets = Object.fromEntries(
    ['zip', 'installer', 'appImage'].map((kind) => {
      const name = packageNames(version)[kind]
      const matches = release.assets.filter((asset) => asset.name === name)
      assert.equal(matches.length, 1, 'Duplicate predecessor asset')
      const asset = matches[0]
      assert.match(asset.digest ?? '', /^sha256:[a-f0-9]{64}$/, 'Missing predecessor checksum')
      assert.equal(
        asset.browser_download_url,
        `https://github.com/${releaseRepository}/releases/download/v${version}/${name}`,
        'Unexpected predecessor download URL',
      )
      return [kind, { name, url: asset.browser_download_url, sha256: asset.digest.slice(7) }]
    }),
  )
  return { version, sourceCommit: release.target_commitish, assets }
}

export function retiredInstallerAssets(releases, before, current) {
  assert(semver.valid(before) && semver.valid(current) && semver.lte(before, current))
  return releases.flatMap((release) => {
    const version = versionOf(release)
    if (!version || !semver.lt(version, before)) return []
    const channel = String(semver.prerelease(version)?.[0] ?? 'latest')
    const names = new Set([
      ...Object.values(packageNames(version)),
      `QuestBranch-Setup-${version}-x64.exe.blockmap`,
      `${channel}.yml`,
      `${channel}-linux.yml`,
      `${channel}-safe-linux.yml`,
    ])
    return [{ ...release, assets: release.assets.filter((asset) => names.has(asset.name)) }]
  })
}

export async function readReleaseCatalog() {
  const response = await fetch(
    `https://api.github.com/repos/${releaseRepository}/releases?per_page=100`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    },
  )
  assert(response.ok, `Cannot read published releases: HTTP ${response.status}`)
  const releases = await response.json()
  assert(Array.isArray(releases) && releases.length < 100, 'Release catalog needs pagination')
  return releases
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv[2], 'previous')
  console.log(
    JSON.stringify(
      selectPreviousRelease(
        await readReleaseCatalog(),
        JSON.parse(readFileSync('package.json')).version,
      ),
    ),
  )
}
