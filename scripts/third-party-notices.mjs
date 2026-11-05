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
const unresolved = new Set()
function collect(directory) {
  const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  const id = `${metadata.name}@${metadata.version}`
  const license = typeof metadata.license === 'string' ? metadata.license : metadata.license?.type
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
    texts.push(
      `Source: ${override.source}\n${override.reason}\n\n${contents.toString('utf8').trimEnd()}`,
    )
  }
  if (!texts.length && override?.unresolved) {
    unresolved.add(id)
    texts.push(
      `UNRESOLVED ORIGINAL NOTICE\nSource inspected: ${override.source}\n${override.reason}`,
    )
  }
  if (!texts.length && id === 'sessionweave@0.0.0' && license === 'UNLICENSED') {
    const source = JSON.parse(readFileSync(join(root, 'vendor/sessionweave-source.json'), 'utf8'))
    if (hash(readFileSync(resolve(root, source.file))) !== source.sha256)
      throw new Error('SessionWeave 私有快照校验不符')
    texts.push(
      `Private local snapshot. No open-source license grant is supplied.\nSource commit: ${source.sourceCommit}\nArchive SHA-256: ${source.sha256}\nPublic redistribution requires a separate licensing decision.`,
    )
  }
  if (!texts.length) throw new Error(`缺少原始许可文本：${id}；请核对来源后补充该版本的声明`)
  const text = `${id}\nDeclared license: ${license}\n\n${texts.join('\n\n')}`
  if (packages.has(id) && packages.get(id) !== text) throw new Error(`同版本的许可不同：${id}`)
  packages.set(id, text)
}
for (const records of Object.values(inventory))
  for (const record of records) for (const directory of record.paths) collect(directory)
const require = createRequire(join(root, 'package.json'))
// These development packages contribute runtime code or generated styles.
for (const name of ['tailwindcss', 'electron'])
  collect(dirname(require.resolve(`${name}/package.json`)))
const codexNotice = readFileSync(join(root, 'licenses/openai-codex.NOTICE'), 'utf8').trimEnd()
const lockHash = hash(readFileSync(join(root, 'pnpm-lock.yaml')))
const text = `QuestBranch standalone third-party notices

Generated from the lockfile's installed production inventory on ${process.platform}/${process.arch},
plus Electron and the Tailwind stylesheet license. This is a conservative
dependency inventory, not a declaration that every listed package is bundled.
Electron's accompanying LICENSE.electron.txt and LICENSES.chromium.html must
also remain with the distributed application. The bundled Codex upstream
NOTICE follows this inventory.

QuestBranch has no selected project license. SessionWeave is a private,
UNLICENSED snapshot. These notices do not grant rights to either project.
${unresolved.size} dependency declarations have no verified original notice below;
those entries remain unresolved and must be reviewed before public distribution.

Lockfile SHA-256: ${lockHash}
Packages: ${packages.size}

${[...packages]
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([, value]) => `${'='.repeat(80)}\n${value}`)
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
  `Third-party notices: ${packages.size} packages; ${unresolved.size} unresolved original texts`,
)
for (const id of [...unresolved].sort()) console.log(`Unresolved: ${id}`)
