import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import semver from 'semver'

export function updateAssetNames(version) {
  const channel = String(semver.prerelease(version)?.[0] ?? 'latest')
  return {
    windows: [`${channel}.yml`, `QuestBranch-Setup-${version}-x64.exe.blockmap`],
    linux: [`${channel}-linux.yml`],
  }
}

// Validate the SDK feed against the exact bytes accepted by platform verification.
export function verifyUpdateAssets(directory, version) {
  const names = updateAssetNames(version)
  for (const [platform, feedNames] of Object.entries(names)) {
    const feed = yaml.load(readFileSync(join(directory, feedNames[0]), 'utf8'))
    assert.equal(feed.version, version, 'Update metadata belongs to another version')
    const target =
      platform === 'windows'
        ? `QuestBranch-Setup-${version}-x64.exe`
        : `QuestBranch-${version}-linux-x86_64.AppImage`
    assert(Array.isArray(feed.files) && feed.files.length > 0, 'Missing update payload')
    assert.equal(feed.stagingPercentage, undefined, 'Staged rollout is not configured')
    assert.equal(feed.packages, undefined, 'Web installers are not supported')
    let found = false
    for (const file of feed.files) {
      // Linux also lists its accepted DEB; it remains a manual installation.
      assert([target, `QuestBranch-${version}-linux-amd64.deb`].includes(file.url))
      if (platform === 'windows') assert.equal(file.url, target)
      const bytes = readFileSync(join(directory, file.url))
      if (file.size !== undefined)
        assert.equal(file.size, bytes.length, 'Update payload size mismatch')
      assert.equal(
        file.sha512,
        createHash('sha512').update(bytes).digest('base64'),
        'Update payload digest mismatch',
      )
      if (file.url === target) found = true
    }
    assert(found, 'No accepted native installer in the update feed')
    assert(
      feed.files.some((file) => file.url === feed.path),
      'Legacy path is not an accepted payload',
    )
    assert.equal(
      feed.sha512,
      createHash('sha512')
        .update(readFileSync(join(directory, feed.path)))
        .digest('base64'),
    )
    for (const name of feedNames) assert(readFileSync(join(directory, name)).length > 0)
  }
  return [...names.windows, ...names.linux]
}
