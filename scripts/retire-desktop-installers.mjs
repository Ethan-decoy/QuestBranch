import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { releaseRepository, retiredInstallerAssets } from './desktop-release-catalog.mjs'

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Retire installers only in the release workflow')
assert.equal(process.env.GITHUB_REPOSITORY, releaseRepository)
const version = JSON.parse(readFileSync('package.json')).version
assert.equal(process.env.GITHUB_REF, `refs/tags/v${version}`)
const before = process.argv.find((arg) => arg.startsWith('--before='))?.slice(9)
const api = (path, method = 'GET', body) => {
  const output = execFileSync(
    'gh',
    [
      'api',
      `repos/${releaseRepository}/${path}`,
      '--method',
      method,
      ...(body ? ['--input', '-'] : []),
    ],
    {
      encoding: 'utf8',
      input: body ? JSON.stringify(body) : undefined,
      maxBuffer: 4 * 1024 * 1024,
    },
  )
  return output.trim() ? JSON.parse(output) : null
}
const current = api(`releases/tags/v${version}`)
assert(
  !current.draft && current.prerelease && current.published_at,
  'New prerelease is not published',
)
assert.equal(
  current.target_commitish,
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
)
const record = JSON.parse(readFileSync('release/VERIFICATION.json', 'utf8').replace(/^\uFEFF/, ''))
assert.equal(record.version, version)
assert.equal(record.sourceCommit, current.target_commitish)
const expected = readFileSync('release/SHA256SUMS.txt', 'utf8')
  .trim()
  .split(/\r?\n/)
  .map((line) => {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$/.exec(line)
    assert(match, 'Invalid accepted checksum manifest')
    return { digest: `sha256:${match[1]}`, name: match[2] }
  })
expected.push({
  name: 'SHA256SUMS.txt',
  digest: `sha256:${createHash('sha256').update(readFileSync('release/SHA256SUMS.txt')).digest('hex')}`,
})
assert.equal(current.assets.length, expected.length, 'New prerelease assets are incomplete')
for (const asset of expected) {
  const remote = current.assets.filter((item) => item.name === asset.name)
  assert.equal(remote.length, 1)
  assert.equal(remote[0].state, 'uploaded')
  assert.equal(remote[0].digest, asset.digest, `New prerelease checksum mismatch: ${asset.name}`)
}

const releases = api('releases?per_page=100')
assert(releases.length < 100, 'Release catalog needs pagination')
const plan = retiredInstallerAssets(releases, before, version)
const report = {
  before,
  replacement: current.html_url,
  source: current.target_commitish,
  releases: [],
}
mkdirSync('artifacts/release-evidence', { recursive: true })
const reportPath = join('artifacts/release-evidence', 'installer-retirement.json')
for (const release of plan) {
  const outcome = { tag: release.tag_name, deleted: [] }
  report.releases.push(outcome)
  for (const asset of release.assets) {
    const actual = api(`releases/assets/${asset.id}`)
    assert.equal(actual.name, asset.name)
    assert.equal(actual.digest, asset.digest)
    api(`releases/assets/${asset.id}`, 'DELETE')
    outcome.deleted.push({ id: asset.id, name: asset.name, digest: asset.digest })
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  }
  const latest = api(`releases/${release.id}`)
  assert.equal(retiredInstallerAssets([latest], before, version)[0].assets.length, 0)
  const notice =
    '> 旧安装包已撤下，源码和版本记录保留。请使用新版 / Previous installers were retired; source and release records remain. Download: '
  if (!latest.body?.startsWith(notice))
    api(`releases/${release.id}`, 'PATCH', {
      body: `${notice}${current.html_url}\n\n${latest.body ?? ''}`,
    })
}
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
