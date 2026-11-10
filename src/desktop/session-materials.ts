import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import type { SessionWeave } from 'sessionweave'
import type { ResearchStore } from './store'

const backups = new WeakMap<ResearchStore, Promise<void>>()
const feature = 'sessionweave-materials-v4'

/** Create one complete pre-upgrade backup before publishing the first new-format material. */
async function backupBeforeMaterials(store: ResearchStore) {
  const root = resolve(store.directory, 'backups')
  const destination = join(root, `before-${feature}`)
  if (existsSync(destination)) {
    const record = JSON.parse(readFileSync(join(destination, 'backup.json'), 'utf8'))
    if (
      record.feature !== feature ||
      !existsSync(join(destination, 'research.sqlite')) ||
      (record.credentialKey && !existsSync(join(destination, '.credential-key')))
    )
      throw new Error('会话升级备份不完整；原研究资料保留，尚未写入新材料格式')
    return
  }
  mkdirSync(root, { recursive: true })
  const staging = mkdtempSync(join(root, '.session-upgrade-'))
  try {
    await store.sessions.backup(join(staging, 'research.sqlite'))
    const database = new DatabaseSync(join(staging, 'research.sqlite'), { readOnly: true })
    try {
      if (database.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok')
        throw new Error('研究库升级备份校验失败；尚未写入新材料格式')
    } finally {
      database.close()
    }
    const credentialKey = existsSync(join(store.directory, '.credential-key'))
    if (credentialKey)
      copyFileSync(join(store.directory, '.credential-key'), join(staging, '.credential-key'))
    writeFileSync(
      join(staging, 'backup.json'),
      JSON.stringify({ feature, createdAt: new Date().toISOString(), credentialKey }, null, 2) +
        '\n',
    )
    renameSync(staging, destination)
  } finally {
    // staging is the absolute, newly created directory directly under this research backup root.
    rmSync(staging, { recursive: true, force: true })
  }
}

export async function updateSessionMaterials(
  session: SessionWeave,
  store: ResearchStore,
  text: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  const current = await session.inspect()
  const id = 'qb-research-context'
  const head = current.materials.find((material) => material.id === id)
  if (head?.action === 'set') {
    const previous = await session.read({
      sessionId: session.sessionId,
      materialId: id,
      version: head.version,
    })
    if (previous.action === 'set' && previous.text === text) return
  }
  if (!current.materials.length) {
    let pending = backups.get(store)
    if (!pending) {
      pending = backupBeforeMaterials(store).catch((error) => {
        backups.delete(store)
        throw error
      })
      backups.set(store, pending)
    }
    await pending
  }
  signal.throwIfAborted()
  // Include the predecessor so restoring older content creates a new revision, not a replay.
  const version = createHash('sha256')
    .update(JSON.stringify([head?.version ?? null, text]))
    .digest('hex')
  await session.updateMaterials([{ id, version, action: 'set', text }], {
    expectedRevision: current.revision,
    signal,
  })
}
