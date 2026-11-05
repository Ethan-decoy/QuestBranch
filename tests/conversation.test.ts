import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { ResearchStore } from '../src/desktop/store'
import { ResearchService } from '../src/desktop/service'
import { PiModels, type ModelOutput } from '../src/desktop/pi-models'
import { buildContext } from '../src/research/context'
import type { ConnectionResult, ResearchRun } from '../src/research/types'

const connected: ConnectionResult = {
  models: ['fixture-model'],
  provider: 'openai',
  status: 'configured',
  modelDiscovery: 'catalog',
  catalog: { models: [], defaults: { model: 'fixture-model', reasoningEffort: 'high' } },
}

const stores: ResearchStore[] = [],
  directories: string[] = []
function store() {
  vi.stubEnv('TAVILY_API_KEY', '')
  const directory = mkdtempSync(join(tmpdir(), 'qb-conversation-test-'))
  directories.push(directory)
  const db = new ResearchStore(directory)
  stores.push(db)
  return db
}
function chat(
  db: ResearchStore,
  nodeId = 'visual',
  instruction = '只讨论当前方向',
  output = '这是当前节点的讨论内容。',
) {
  const run: ResearchRun = {
    id: randomUUID(),
    workspaceId: 'welcome-research',
    nodeId,
    instruction,
    output: '',
    error: '',
    model: 'fixture-model',
    mode: 'chat',
    provider: 'codex',
    phase: '对话中',
    status: 'running',
    context: buildContext(db.snapshot(), nodeId, instruction, [], 'chat'),
    createdAt: new Date().toISOString(),
  }
  db.saveRun(run)
  db.saveRun({ ...run, output, status: 'completed', finishedAt: new Date().toISOString() })
  return db.run(run.id)
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const db of stores.splice(0)) {
    try {
      db.close()
    } catch {}
  }
  for (const directory of directories.splice(0)) {
    const target = resolve(directory)
    if (
      !target.startsWith(resolve(tmpdir()) + sep) ||
      !/^qb-conversation-(?:test|restore)-/.test(basename(target))
    )
      throw new Error('Unexpected test cleanup path')
    rmSync(target, { recursive: true, force: true })
  }
})
describe('节点对话与报告的分别保存', () => {
  it('只承接本节点的完整对话，保留明确的消息引用与本轮指令', () => {
    const db = store()
    chat(db, 'context', 'SIBLING_CONVERSATION', '不能进入其他节点的讨论')
    const first = chat(db, 'visual', '第一个选择是什么？', '第一种是卡片。')
    const pack = buildContext(db.snapshot(), 'visual', '继续比较', [], 'chat')
    expect(
      pack.messages.some(
        (message) => message.role === 'assistant' && message.content === first.output,
      ),
    ).toBe(true)
    expect(JSON.stringify(pack.messages)).not.toContain('SIBLING_CONVERSATION')
    expect(pack.messages.at(-1)?.content).toBe('继续比较')
    expect(pack.conversation?.includedMessageIds).toHaveLength(2)
    expect(pack.estimatedTokens).toBeLessThanOrEqual(pack.budget)
    expect(db.snapshot().reports).toHaveLength(3)
    expect(() =>
      db.complete(first.id, {
        title: '错误转换',
        summary: '不能直接转换',
        findings: [],
        openQuestions: [],
        report: '这不是合法的新研究报告转换。',
        followups: [],
      }),
    ).toThrow()
  })
  it('历史过长时省略完整轮次，并说明取舍', () => {
    const db = store()
    for (let i = 0; i < 4; i++) chat(db, 'visual', `第${i}轮`, '讨论'.repeat(1500))
    db.saveSettings({ ...db.settings(), contextBudget: 4000 })
    const pack = buildContext(db.snapshot(), 'visual', '继续', [], 'chat')
    expect(pack.conversation?.omittedMessageIds.length).toBeGreaterThan(0)
    expect(pack.limitations.join('')).toContain('较早')
    expect(pack.estimatedTokens).toBeLessThanOrEqual(pack.budget)
  })
  it('导出恢复保留对话，重复导入不覆盖资料', () => {
    const first = store(),
      run = chat(first, 'visual', '保留完整长回复', '原文'.repeat(55000))
    first.saveView('welcome-research', {
      selectedId: 'visual',
      collapsed: [],
      drafts: { visual: '研究报告的草稿' },
      chatDrafts: { visual: '尚未发送的对话草稿' },
    })
    const exported = first.exportWorkspace('welcome-research')
    const second = store()
    const other = second.createWorkspace('另一个独立空间')
    const payload = {
      ...exported,
      workspace: {
        ...exported.workspace,
        id: other,
        rootId: second.snapshot().workspaces.find((w) => w.id === other)!.rootId,
      },
    }
    expect(() => second.importWorkspace(payload)).toThrow()
    const directory = mkdtempSync(join(tmpdir(), 'qb-conversation-restore-'))
    directories.push(directory)
    const restored = new ResearchStore(directory, { seed: false })
    stores.push(restored)
    restored.importWorkspace(exported)
    expect(restored.exportWorkspace('welcome-research')).toEqual(exported)
    expect(
      restored
        .snapshot()
        .messages.find((message) => message.runId === run.id && message.role === 'assistant')
        ?.content,
    ).toBe(run.output)
    expect(() => restored.importWorkspace(exported)).toThrow('已存在')
  })
  it('取消后的迟到原始输出不会改写已停止的可见对话', () => {
    const db = store(),
      completed = chat(db)
    const run = { ...completed, id: randomUUID(), output: '已有片段', status: 'running' as const }
    db.saveRun(run)
    db.saveRun({ ...run, status: 'cancelled' })
    db.saveRun({ ...run, status: 'cancelled', output: '已有片段和迟到原文' })
    expect(db.run(run.id).output).toContain('迟到原文')
    expect(
      db
        .snapshot()
        .messages.find((message) => message.runId === run.id && message.role === 'assistant')
        ?.content,
    ).toBe('已有片段')
  })
  it('从旧数据库升级时保留原有节点和报告', () => {
    const db = store(),
      before = db.snapshot(),
      directory = db.directory
    db.close()
    const legacy = new DatabaseSync(join(directory, 'research.sqlite'))
    legacy.exec('DROP TABLE messages; PRAGMA user_version=1;')
    legacy.close()
    const reopened = new ResearchStore(directory)
    stores.push(reopened)
    expect(reopened.snapshot().nodes).toEqual(before.nodes)
    expect(reopened.snapshot().reports).toEqual(before.reports)
    expect(reopened.snapshot().messages).toEqual([])
    chat(reopened)
    expect(reopened.snapshot().messages).toHaveLength(2)
  })
  it('账号对话不复用 API 密钥，切换焦点不改变回复归属', async () => {
    const db = store()
    db.saveSettings({
      ...db.settings(),
      provider: 'compatible',
      modelProvider: 'custom',
      baseUrl: 'http://127.0.0.1:8999/v1',
      apiKey: 'unrelated-key',
    })
    db.saveSettings({
      ...db.settings(),
      provider: 'account',
      modelProvider: 'openai',
      model: 'fixture-model',
      baseUrl: '',
    })
    let finish: (value: string) => void = () => {}
    const reply = new Promise<string>((resolve) => {
      finish = resolve
    })
    const runtime = new PiModels(db)
    vi.spyOn(runtime, 'connect').mockResolvedValue(connected)
    const generate = vi
      .spyOn(runtime, 'generate')
      .mockImplementation(async () => ({ raw: await reply }))
    const service = new ResearchService(db, runtime)
    await service.testConnection()
    const result = await service.command({
      type: 'send-message',
      nodeId: 'visual',
      message: '当前方向的问题',
    })
    db.saveView('welcome-research', { selectedId: 'context', collapsed: [], drafts: {} })
    finish('回复始终保存在最初发起对话的节点。')
    await vi.waitFor(() => expect(db.run(result.id!).status).toBe('completed'))
    expect(db.snapshot().messages.every((message) => message.nodeId === 'visual')).toBe(true)
    expect(db.snapshot().reports).toHaveLength(3)
    expect(generate.mock.calls[0][1]).toBe('')
    service.shutdown()
  })
  it('连接不保存候选配置，实际思考强度随研究记录导出和恢复', async () => {
    const db = store()
    const before = db.settings()
    const runtime = new PiModels(db)
    const test = vi.spyOn(runtime, 'connect').mockResolvedValue(connected)
    vi.spyOn(runtime, 'generate').mockImplementation(
      async (
        _settings,
        _key,
        _messages,
        _signal,
        _onChunk,
        _schema,
        onModel,
      ): Promise<ModelOutput> => {
        onModel?.({
          model: 'fixture-model',
          reasoningEffort: 'high',
          pi: { provider: 'openai', api: 'openai-responses', responseId: 'fixture-response' },
        })
        return { raw: '保留模型实际使用的思考强度。' }
      },
    )
    const service = new ResearchService(db, runtime)
    await service.testConnection({
      ...before,
      provider: 'account',
      model: 'fixture-model',
      reasoningEffort: 'high',
    })
    expect(db.settings()).toEqual(before)
    expect(test.mock.calls[0][0]).toMatchObject({ provider: 'account', reasoningEffort: 'high' })
    await service.command({
      type: 'save-settings',
      settings: { ...before, provider: 'account', model: 'fixture-model', reasoningEffort: 'high' },
    })
    expect(db.settings().reasoningEffort).toBe('high')
    const { id } = await service.command({
      type: 'send-message',
      nodeId: 'visual',
      message: '测试设置归属',
    })
    await vi.waitFor(() => expect(db.run(id!).status).toBe('completed'))
    expect(db.run(id!).reasoningEffort).toBe('high')
    const exported = db.exportWorkspace('welcome-research')
    expect(exported.runs.find((run) => run.id === id)?.reasoningEffort).toBe('high')
    const directory = mkdtempSync(join(tmpdir(), 'qb-conversation-restore-'))
    directories.push(directory)
    const empty = new ResearchStore(directory, { seed: false })
    stores.push(empty)
    empty.importWorkspace(exported)
    expect(empty.run(id!).reasoningEffort).toBe('high')
    service.shutdown()
  })
})
