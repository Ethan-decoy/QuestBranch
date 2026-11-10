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
    .update(readFileSync(resolve(root, provenance.licenseText.file)))
    .digest('hex') !== provenance.licenseText.sha256
)
  throw new Error('SessionWeave 发行包的 MIT 许可校验失败')
const installed = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.resolve('sessionweave')), 'utf8'),
)
if (
  createHash('sha256')
    .update(readFileSync(new URL('../LICENSE', import.meta.resolve('sessionweave'))))
    .digest('hex') !== provenance.licenseText.sha256
)
  throw new Error('SessionWeave 已安装包的原始许可文本不符')
if (installed.version !== provenance.version || installed.license !== provenance.license)
  throw new Error('SessionWeave 安装版本或许可与固定发行不符')
const { SessionWeave, getModelCallContext } = await import('sessionweave')
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
  getModelCallContext,
  SessionWeave.prototype.updateMaterials,
])
  if (typeof entry !== 'function') throw new Error('SessionWeave 正式包入口缺失')
console.log(
  JSON.stringify(
    {
      version: installed.version,
      source: provenance.sourceCommit,
      sha256: actual,
      entries: 7,
      peers: provenance.peers,
    },
    null,
    2,
  ),
)
