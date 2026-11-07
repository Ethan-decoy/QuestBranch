import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

assert(process.versions.electron, 'Run with the packaged executable and ELECTRON_RUN_AS_NODE=1')
const root = resolve('.')
const app = resolve('release/win-unpacked')
const archive = join(app, 'resources/app.asar')
const rawRead = createRequire(import.meta.url)('original-fs').readFileSync
const sha256 = (path) => createHash('sha256').update(rawRead(path)).digest('hex')
const files = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
const compiled = files(join(root, 'out'))
for (const file of compiled)
  assert(readFileSync(file).equals(readFileSync(join(archive, relative(root, file)))))
assert.equal(files(join(archive, 'out')).length, compiled.length)
const licenses = [
  'THIRD_PARTY_NOTICES.txt',
  'LICENSE',
  'LICENSING.md',
  'vendor/sessionweave-source.json',
  ...files(join(root, 'licenses')).map((file) => relative(root, file)),
]
for (const file of licenses)
  assert(readFileSync(join(root, file)).equals(readFileSync(join(app, file))))
const version = JSON.parse(readFileSync('package.json')).version
assert.equal(JSON.parse(readFileSync(join(archive, 'package.json'))).version, version)
const record = {
  version,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  electron: process.versions.electron,
  node: process.versions.node,
  compiledFiles: compiled.length,
  licenseFiles: licenses.length,
  contentMatchesBuildInputs: true,
  asarSha256: sha256(archive),
}
mkdirSync('artifacts/release-evidence', { recursive: true })
writeFileSync('artifacts/release-evidence/package-integrity.json', JSON.stringify(record, null, 2))
console.log(JSON.stringify(record))
