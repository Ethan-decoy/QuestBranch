// Run with the final QuestBranch.exe and ELECTRON_RUN_AS_NODE=1. Only deterministic
// local SDK output is used; no application profile, credentials or network are opened.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { desktopPackage } from './desktop-package.mjs'

assert(process.versions.electron, 'Use the packaged Electron executable')
const packagePaths = desktopPackage()
const root = packagePaths.archive
const provenance = JSON.parse(
  readFileSync(join(packagePaths.resources, 'vendor/sessionweave-source.json'), 'utf8'),
)
assert.equal(provenance.version, '0.1.0-beta.3')
assert.equal(provenance.archiveMetadataLicense, 'MIT')
const chunks = join(root, 'out/main/chunks')
const matches = readdirSync(chunks).filter((name) => /^om-.*\.js$/.test(name))
assert.equal(matches.length, 1, 'The OM SDK graph must be bundled before dependency flattening')
const { createOmWorkingMemory } = await import(pathToFileURL(join(chunks, matches[0])).href)
let calls = 0
const model = {
  specificationVersion: 'v2',
  provider: 'offline-qb-verification',
  modelId: 'packaged-om-fixture',
  supportedUrls: {},
  async doGenerate() {
    throw new Error('Expected the OM streaming path')
  },
  async doStream() {
    calls++
    return {
      stream: new ReadableStream({
        start(controller) {
          const text =
            '<observations>\n* 🔴 (09:00) Packaged runtime preserves the recorded research constraint.\n</observations>\n<current-task>Continue the current research.</current-task>'
          for (const part of [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'fixture' },
            { type: 'text-delta', id: 'fixture', delta: text },
            { type: 'text-end', id: 'fixture' },
            {
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: 30, outputTokens: 40, totalTokens: 70 },
            },
          ])
            controller.enqueue(part)
          controller.close()
        },
      }),
    }
  },
}
const memory = createOmWorkingMemory({ model, modelId: 'packaged-om-fixture@1' })
const candidate = await memory.derive({
  sessionId: 'packaged-session',
  sourceRevision: 2,
  messages: [
    {
      id: 'u1',
      role: 'user',
      text: 'Preserve the research constraint.',
      sequence: 1,
      createdAt: '2026-11-02T00:00:00.000Z',
    },
    {
      id: 'a1',
      role: 'assistant',
      text: 'The constraint is recorded.',
      sequence: 2,
      createdAt: '2026-11-02T00:00:01.000Z',
    },
  ],
  previous: null,
  reflow: false,
})
assert(calls > 0)
assert.equal(candidate.complete, true)
assert.equal(candidate.sourceThroughId, 'a1')
assert(candidate.projection.includes('Packaged runtime'))
assert(candidate.identity.policy.includes('research-retention@2'))
mkdirSync(resolve('artifacts/sessionweave-runtime'), { recursive: true })
const folder = mkdtempSync(resolve('artifacts/sessionweave-runtime/check-'))
const record = {
  packagedExecutable: process.execPath,
  appRoot: root,
  electron: process.versions.electron,
  node: process.versions.node,
  source: `compiled official SessionWeave ${provenance.version} release`,
  sourceCommit: provenance.sourceCommit,
  archiveSha256: provenance.sha256,
  realOmSdk: true,
  sdkFixtureOnly: true,
  calls,
  identity: candidate.identity,
  bundle: matches[0],
  nativeOrLongTermQualityValidated: false,
}
writeFileSync(join(folder, 'result.json'), JSON.stringify(record, null, 2) + '\n')
console.log(JSON.stringify({ ...record, folder }, null, 2))
