import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const provenance = JSON.parse(
  readFileSync(resolve(root, 'vendor/sessionweave-source.json'), 'utf8'),
)
const bytes = readFileSync(resolve(root, provenance.file))
const actual = createHash('sha256').update(bytes).digest('hex')
if (actual !== provenance.sha256) throw new Error('SessionWeave 固定产物校验失败')
if (
  provenance.license !== 'MIT' ||
  createHash('sha256')
    .update(readFileSync(resolve(root, provenance.licenseGrant.file)))
    .digest('hex') !== provenance.licenseGrant.sha256
)
  throw new Error('SessionWeave 固定快照的补充 MIT 许可校验失败')
const { SessionWeave } = await import('sessionweave')
const { FileStore } = await import('sessionweave/file-store')
const { toPiContext } = await import('sessionweave/pi')
const { createOpenAINativeAdapter } = await import('sessionweave/native')
const { createOmWorkingMemory } = await import('sessionweave/om')
for (const entry of [
  SessionWeave,
  FileStore,
  toPiContext,
  createOpenAINativeAdapter,
  createOmWorkingMemory,
])
  if (typeof entry !== 'function') throw new Error('SessionWeave 正式包入口缺失')
console.log(
  JSON.stringify(
    { source: provenance.sourceCommit, sha256: actual, entries: 5, peers: provenance.peers },
    null,
    2,
  ),
)
