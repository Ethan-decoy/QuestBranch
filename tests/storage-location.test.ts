import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { ResearchStore } from '../src/desktop/store'
import {
  loadStorageLocation,
  relocateResearchStorage,
  validateStorageDestination,
} from '../src/desktop/storage-location'
import { buildContext } from '../src/research/context'
import type { ResearchRun } from '../src/research/types'

const roots: string[] = []
const stores: ResearchStore[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'questbranch-storage-test-'))
  roots.push(root)
  const userData = join(root, 'profile')
  const source = join(userData, 'research')
  const target = join(root, '自选保存位置')
  mkdirSync(target)
  const store = new ResearchStore(source)
  stores.push(store)
  return { root, userData, source, target, store }
}
function run(store: ResearchStore): ResearchRun {
  return {
    id: randomUUID(),
    workspaceId: 'welcome-research',
    nodeId: 'visual',
    instruction: '保留这轮讨论',
    status: 'running',
    phase: '对话中',
    output: '',
    error: '',
    model: 'fixture',
    mode: 'chat',
    context: buildContext(store.snapshot(), 'visual', '保留这轮讨论', [], 'chat'),
    createdAt: new Date().toISOString(),
  }
}
afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  for (const root of roots.splice(0)) {
    const target = resolve(root)
    if (
      !target.startsWith(resolve(tmpdir()) + sep) ||
      !basename(target).startsWith('questbranch-storage-test-')
    )
      throw new Error('Unexpected storage test cleanup path')
    await rm(target, { recursive: true, force: true })
  }
})

describe('自选保存位置与完整迁移', () => {
  it('优先使用显式启动覆盖，默认位置保持兼容', () => {
    const { root, userData, target } = fixture()
    expect(loadStorageLocation(userData)).toEqual({
      directory: join(userData, 'research'),
      source: 'default',
    })
    writeFileSync(join(userData, 'storage-location.json'), 'broken configuration')
    expect(loadStorageLocation(userData, target)).toEqual({
      directory: target,
      source: 'environment',
    })
    expect(loadStorageLocation(userData, 'relative-research').directory).toBe(
      resolve('relative-research'),
    )
    expect(() => loadStorageLocation(userData)).toThrow('无法打开自选研究位置')
    writeFileSync(
      join(userData, 'storage-location.json'),
      JSON.stringify({ version: 1, directory: join(root, 'offline-drive') }),
    )
    expect(() => loadStorageLocation(userData)).toThrow('找不到研究数据库')
    expect(existsSync(join(root, 'offline-drive'))).toBe(false)
  })

  it('将 WAL 内的记录、修订、草稿、全部研究和加密设置一起复制，重开后保持一致', async () => {
    const { root, userData, source, target, store } = fixture()
    store.createWorkspace('第二项研究', '另一个空间')
    store.editNode('visual', '保留修改前的问题历史')
    store.saveSettings({
      ...store.settings(),
      model: 'fixture',
      apiKey: 'test-storage-key',
      searchKey: 'test-search-key',
    })
    store.saveView('welcome-research', {
      revision: Date.now(),
      selectedId: 'visual',
      collapsed: ['context'],
      drafts: { visual: '还没发送的研究草稿' },
      chatDrafts: { visual: '还没发送的对话' },
      viewport: { x: 42, y: 17, zoom: 0.8 },
    })
    const conversation = run(store)
    store.saveRun(conversation)
    store.saveRun({ ...conversation, status: 'completed', output: '一条需要长期保留的原始回复。' })
    const research = { ...run(store), id: randomUUID(), mode: undefined }
    store.saveRun(research)
    store.complete(research.id, {
      title: '迁移前的报告',
      summary: '保留报告历史与分支关系。',
      findings: ['保留认识'],
      openQuestions: ['还有什么需要探索？'],
      report: '## 原始报告\n\n这份研究报告与原始记录应在更换保存位置后完整保留。',
      followups: [{ title: '新的分支', question: '新分支的资料能否一起迁移？' }],
    })
    expect(statSync(join(source, 'research.sqlite-wal')).size).toBeGreaterThan(0)
    const exports = store
      .snapshot()
      .workspaces.map((workspace) => store.exportWorkspace(workspace.id))
    const settings = store.settings()
    await expect(relocateResearchStorage(store, userData, target)).resolves.toBe(target)
    expect(loadStorageLocation(userData)).toEqual({ directory: target, source: 'preference' })
    const reopened = new ResearchStore(loadStorageLocation(userData).directory)
    stores.push(reopened)
    expect(
      reopened.snapshot().workspaces.map((workspace) => reopened.exportWorkspace(workspace.id)),
    ).toEqual(exports)
    expect(reopened.settings()).toEqual(settings)
    expect(reopened.credentials()).toEqual(store.credentials())
    expect(readFileSync(join(target, '.credential-key'))).toEqual(
      readFileSync(join(source, '.credential-key')),
    )
    expect(
      store.snapshot().workspaces.map((workspace) => store.exportWorkspace(workspace.id)),
    ).toEqual(exports)
    expect(readdirSync(target).some((name) => name.startsWith('.questbranch-migration-'))).toBe(
      false,
    )
    // A second move atomically replaces the existing preference and retains both old copies.
    const next = join(root, 'second-destination')
    mkdirSync(next)
    await relocateResearchStorage(reopened, userData, next)
    expect(loadStorageLocation(userData).directory).toBe(next)
    expect(existsSync(join(source, 'research.sqlite'))).toBe(true)
    expect(existsSync(join(target, 'research.sqlite'))).toBe(true)
  })

  it('拒绝迁移仍在运行的研究，保持原位置与数据', async () => {
    const { userData, target, store } = fixture()
    const active = run(store)
    store.saveRun(active)
    await expect(relocateResearchStorage(store, userData, target)).rejects.toThrow('研究结束')
    expect(store.run(active.id).status).toBe('running')
    expect(readdirSync(target)).toEqual([])
    expect(loadStorageLocation(userData).source).toBe('default')
  })

  it('拒绝当前目录、其子目录与任何非空目录，不覆盖已有资料', async () => {
    const { userData, source, target, store } = fixture()
    expect(() => validateStorageDestination(source, source)).toThrow('研究目录以外')
    const nested = join(source, 'nested')
    mkdirSync(nested)
    expect(() => validateStorageDestination(source, nested)).toThrow('研究目录以外')
    writeFileSync(join(target, 'research.sqlite'), 'other research')
    await expect(relocateResearchStorage(store, userData, target)).rejects.toThrow('空文件夹')
    expect(readFileSync(join(target, 'research.sqlite'), 'utf8')).toBe('other research')
    expect(loadStorageLocation(userData).source).toBe('default')
  })

  it('提交保存位置失败时清理本次副本，保留原始研究和配置', async () => {
    const { root, target, store } = fixture()
    const blockedProfile = join(root, 'unwritable-profile')
    writeFileSync(blockedProfile, 'existing file')
    const before = store.exportWorkspace('welcome-research')
    await expect(relocateResearchStorage(store, blockedProfile, target)).rejects.toThrow()
    expect(readdirSync(target)).toEqual([])
    expect(readFileSync(blockedProfile, 'utf8')).toBe('existing file')
    expect(store.exportWorkspace('welcome-research')).toEqual(before)
  })

  it('复制期间目标出现同名文件时不覆盖、不删除它，也不切换保存位置', async () => {
    const { userData, target, store } = fixture()
    const pending = relocateResearchStorage(store, userData, target)
    writeFileSync(join(target, 'research.sqlite'), 'created by another process')
    await expect(pending).rejects.toThrow()
    expect(readdirSync(target)).toEqual(['research.sqlite'])
    expect(readFileSync(join(target, 'research.sqlite'), 'utf8')).toBe('created by another process')
    expect(loadStorageLocation(userData).source).toBe('default')
    expect(store.snapshot().nodes).toHaveLength(8)
  })
})
