import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (pkg.name !== 'questbranch') throw new Error('请在独立应用源码目录执行 pnpm notices')
if (process.argv.slice(2).some((arg) => arg !== '--check'))
  throw new Error('用法：pnpm notices [--check]')
const manager = process.env.npm_execpath
if (!manager) throw new Error('请通过 pnpm notices 或 pnpm notices:check 执行')
const executable = manager.endsWith('.exe') ? manager : process.execPath
const args = manager.endsWith('.exe') ? [] : [manager]
const inventory = JSON.parse(
  execFileSync(executable, [...args, 'licenses', 'list', '--prod', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }),
)
const hash = (content) => createHash('sha256').update(content).digest('hex')
const overrides = JSON.parse(readFileSync(join(root, 'config/third-party-overrides.json'), 'utf8'))
const packages = new Map()
const declarationOnly = new Set()
function collect(directory) {
  const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  const id = `${metadata.name}@${metadata.version}`
  let license = typeof metadata.license === 'string' ? metadata.license : metadata.license?.type
  if (!license) throw new Error(`缺少许可声明：${id}`)
  const texts = readdirSync(directory)
    .filter(
      (file) =>
        /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(file) &&
        statSync(join(directory, file)).isFile(),
    )
    .sort()
    .map(
      (file) =>
        `--- ${file} ---\n${readFileSync(join(directory, file), 'utf8').replaceAll('\r\n', '\n').trimEnd()}`,
    )
  const override = overrides[id]
  if (!texts.length && override?.file) {
    const contents = readFileSync(resolve(root, override.file))
    if (hash(contents) !== override.sha256) throw new Error(`上游许可校验不符：${id}`)
    if (override.declarationFile) {
      const declaration = readFileSync(resolve(root, override.declarationFile))
      if (
        hash(declaration) !== override.declarationSha256 ||
        !declaration.equals(readFileSync(join(directory, 'package.json'))) ||
        license !== override.declaredLicense
      )
        throw new Error(`原始包许可声明校验不符：${id}`)
      declarationOnly.add(id)
      texts.push(
        `Original package manifest (${override.declarationFile}):\n${declaration.toString('utf8').trimEnd()}`,
      )
    }
    texts.push(
      `Source: ${override.source}\n${override.reason}\n\n${contents.toString('utf8').trimEnd()}`,
    )
  }
  if (!texts.length && id === 'sessionweave@0.0.0' && license === 'UNLICENSED') {
    const source = JSON.parse(readFileSync(join(root, 'vendor/sessionweave-source.json'), 'utf8'))
    if (hash(readFileSync(resolve(root, source.file))) !== source.sha256)
      throw new Error('SessionWeave 固定快照校验不符')
    const grant = readFileSync(resolve(root, source.licenseGrant.file))
    if (
      source.license !== 'MIT' ||
      source.archiveMetadataLicense !== license ||
      hash(grant) !== source.licenseGrant.sha256
    )
      throw new Error('SessionWeave 补充许可校验不符')
    texts.push(
      `Fixed source snapshot. Original archive metadata license: ${license}.\nSource commit: ${source.sourceCommit}\nArchive SHA-256: ${source.sha256}\nSupplemental MIT grant dated ${source.licenseGrant.date}: ${source.licenseGrant.scope}\n\n${grant.toString('utf8').trimEnd()}`,
    )
    license = source.license
  }
  if (!texts.length) throw new Error(`缺少原始许可文本：${id}；请核对来源后补充该版本的声明`)
  const notice = { license, text: texts.join('\n\n') }
  const existing = packages.get(id)
  if (existing && (existing.license !== notice.license || existing.text !== notice.text))
    throw new Error(`同版本的许可不同：${id}`)
  packages.set(id, notice)
}
for (const records of Object.values(inventory))
  for (const record of records) for (const directory of record.paths) collect(directory)
const require = createRequire(join(root, 'package.json'))
// These development packages contribute runtime code or generated styles.
for (const name of ['tailwindcss', 'electron'])
  collect(dirname(require.resolve(`${name}/package.json`)))
const codexNotice = readFileSync(join(root, 'licenses/openai-codex.NOTICE'), 'utf8').trimEnd()
const lockHash = hash(readFileSync(join(root, 'pnpm-lock.yaml')))
// Share only byte-identical notice text; retain every package's own declaration.
const notices = new Map()
for (const [id, notice] of [...packages].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
  const declarations = notices.get(notice.text) ?? []
  declarations.push(`${id}\nDeclared license: ${notice.license}`)
  notices.set(notice.text, declarations)
}
const text = `QuestBranch standalone third-party notices

Generated from the lockfile's installed production inventory on ${process.platform}/${process.arch},
plus Electron and the Tailwind stylesheet license. This is a conservative
dependency inventory, not a declaration that every listed package is bundled.
Electron's accompanying LICENSE.electron.txt and LICENSES.chromium.html must
also remain with the distributed application. The bundled Codex upstream
NOTICE follows this inventory.

QuestBranch is MIT licensed; see LICENSE and LICENSING.md. The unchanged
SessionWeave snapshot has an explicit supplemental MIT grant below.
${declarationOnly.size} packages supply MIT declarations only in their original manifests.
Those manifests and standard terms are preserved below; no separate upstream
copyright notice was supplied or invented. Other entries preserve original notices.

Lockfile SHA-256: ${lockHash}
Packages: ${packages.size}
Identical notice texts are printed once with all applicable packages listed.

${[...notices]
  .map(
    ([body, declarations]) =>
      `${'='.repeat(80)}\nApplies to:\n\n${declarations.join('\n\n')}\n\nNotice text and licensing evidence:\n\n${body}`,
  )
  .join('\n\n')}

${'='.repeat(80)}
Bundled Codex upstream NOTICE
Source: ${overrides['@openai/codex@0.160.1'].source.replace(/LICENSE$/, 'NOTICE')}

${codexNotice}
`
const target = join(root, 'THIRD_PARTY_NOTICES.txt')
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== text)
    throw new Error('第三方声明与本机锁定依赖不同，请运行 pnpm notices 并审查变化')
} else writeFileSync(target, text)
console.log(
  `Third-party notices: ${packages.size} packages; ${declarationOnly.size} manifest-only MIT declarations`,
)
for (const id of [...declarationOnly].sort()) console.log(`Manifest-only MIT: ${id}`)
