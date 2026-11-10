import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { ResearchStore } from '../src/desktop/store'
import { ResearchService } from '../src/desktop/service'
import { ancestorPath, buildContext } from '../src/research/context'
import { defaultSettings, type ResearchRun, type ResearchOutput } from '../src/research/types'
import { apiStream } from './fixtures/api-stream'
import { graphPresentation, transitionView } from '../src/ui/research-view'

const stores: ResearchStore[] = [],
  directories: string[] = []
function store(seed = true) {
  vi.stubEnv('TAVILY_API_KEY', '')
  const directory = mkdtempSync(join(tmpdir(), 'questbranch-test-'))
  directories.push(directory)
  const result = new ResearchStore(directory, { seed })
  stores.push(result)
  return result
}
function run(db: ResearchStore, nodeId = 'visual'): ResearchRun {
  return {
    id: randomUUID(),
    workspaceId: 'welcome-research',
    nodeId,
    instruction: '继续研究',
    status: 'running',
    phase: '准备',
    output: '',
    error: '',
    model: 'fixture-model',
    createdAt: new Date().toISOString(),
    context: buildContext(db.snapshot(), nodeId, '继续研究'),
  }
}
const output: ResearchOutput = {
  title: '一份研究报告',
  summary: '先稳定焦点，再安排布局。',
  findings: ['选中节点可以作为布局锚点。'],
  openQuestions: ['多节点移动时如何保持可读？'],
  report: '## 当前认识\n\n这是一份协议验证用的测试报告，不用于生产数据。',
  followups: [{ title: '布局锚点', question: '如何保持研究点的位置？' }],
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  for (const s of stores.splice(0)) s.close()
  for (const path of directories.splice(0)) {
    const absolute = resolve(path)
    if (
      !absolute.startsWith(resolve(tmpdir()) + sep) ||
      !basename(absolute).startsWith('questbranch-test-')
    )
      throw new Error('测试目录越界')
    rmSync(absolute, { recursive: true, force: true })
  }
})

describe('按版本读取研究快照', () => {
  it('版本为零时也能跳过无变化的数据，并保留完整读取入口', () => {
    const db = store(false)
    expect(db.snapshot().version).toBe(0)
    expect(db.snapshot(0)).toBeNull()
    expect(db.snapshot().reports).toEqual([])
  })
  it('变更后返回新快照，不匹配的版本仍能重新同步', () => {
    const db = store()
    const before = db.snapshot()
    const workspace = before.workspaces[0].id
    db.saveView(workspace, { ...before.views[workspace], selectedId: 'context' })
    const updated = db.snapshot(before.version)
    expect(updated?.version).toBeGreaterThan(before.version)
    expect(updated?.views[workspace].selectedId).toBe('context')
    expect(db.snapshot(updated!.version)).toBeNull()
    expect(db.snapshot(updated!.version + 100)?.nodes).toEqual(updated?.nodes)
  })
  it('无变化时不解析报告正文或读取完整设置', () => {
    const db = store()
    const version = db.snapshot().version
    const connection = new DatabaseSync(join(db.directory, 'research.sqlite'))
    try {
      connection.prepare('UPDATE reports SET payload=?').run('invalid-json-for-read-check')
    } finally {
      connection.close()
    }
    const settings = vi.spyOn(db, 'settings')
    expect(db.snapshot(version)).toBeNull()
    expect(settings).not.toHaveBeenCalled()
    expect(() => db.snapshot()).toThrow()
  })
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    '拒绝无效客户端版本 %s',
    async (version) => {
      const service = new ResearchService(store())
      await expect(service.snapshot(version)).rejects.toThrow()
    },
  )
})

describe('可追溯的分支上下文', () => {
  it.each(['database', 'import'] as const)(
    '从 %s 恢复已移除的大纲时保留图谱视角和研究记录',
    (source) => {
      const db = store(),
        workspace = 'welcome-research',
        before = db.snapshot(),
        legacy = {
          ...before.views[workspace],
          selectedId: 'layout',
          drafts: { layout: '未发出的研究指令' },
          chatDrafts: { layout: '未发出的对话' },
          readers: { layout: { tab: 'report', scroll: { 'report:': 450 } } },
          graph: {
            mode: 'outline',
            detail: 'compact',
            focusId: 'visual',
            history: [{ mode: 'outline', detail: 'summary', selectedId: 'visual' }],
            scenes: [
              {
                mode: 'horizontal',
                detail: 'compact',
                focusId: 'visual',
                viewport: { x: 17, y: 31, zoom: 0.8 },
              },
              { mode: 'outline', detail: 'compact', focusId: 'visual', scrollTop: 500 },
              { mode: 'mindmap', detail: 'summary', positions: { visual: { x: 15, y: 25 } } },
            ],
          },
        }
      let restored = db
      if (source === 'database') {
        const connection = new DatabaseSync(join(db.directory, 'research.sqlite'))
        try {
          connection
            .prepare('UPDATE views SET payload=? WHERE workspace_id=?')
            .run(JSON.stringify(legacy), workspace)
        } finally {
          connection.close()
        }
      } else {
        restored = store(false)
        restored.importWorkspace({ ...db.exportWorkspace(workspace), view: legacy })
      }
      const snapshot = restored.snapshot(),
        view = snapshot.views[workspace]
      expect(view).toMatchObject({
        selectedId: legacy.selectedId,
        drafts: legacy.drafts,
        chatDrafts: legacy.chatDrafts,
        readers: legacy.readers,
        graph: {
          mode: 'horizontal',
          detail: 'compact',
          focusId: 'visual',
          history: [{ mode: 'horizontal', selectedId: 'visual' }],
        },
      })
      expect(view.graph?.scenes).toEqual([legacy.graph.scenes[0], legacy.graph.scenes[2]])
      expect(graphPresentation(view).scene.viewport).toEqual({ x: 17, y: 31, zoom: 0.8 })
      for (const field of ['nodes', 'reports', 'runs', 'messages'] as const)
        expect(snapshot[field]).toEqual(before[field])
      const copy = store(false)
      copy.importWorkspace(restored.exportWorkspace(workspace))
      expect(copy.snapshot().views[workspace]).toEqual(view)
    },
  )
  it('恢复视图时过滤跨空间坐标和不可达的分支返回记录', () => {
    const db = store(),
      view = db.snapshot().views['welcome-research']
    db.saveView('welcome-research', {
      ...view,
      selectedId: 'context',
      graph: {
        mode: 'mindmap',
        focusId: 'visual',
        branchSides: { visual: 'left', foreign: 'right' },
        noticedNodeIds: ['visual', 'foreign', 'visual'],
        history: [
          { mode: 'horizontal', detail: 'compact', focusId: 'visual', selectedId: 'layout' },
          { mode: 'horizontal', detail: 'compact', focusId: 'visual', selectedId: 'context' },
        ],
        scenes: [
          {
            mode: 'mindmap',
            detail: 'compact',
            positions: { visual: { x: 33, y: 44 }, foreign: { x: 99, y: 99 } },
          },
        ],
      },
    })
    const restored = db.snapshot().views['welcome-research'].graph!
    expect(restored.focusId).toBeUndefined()
    expect(restored.branchSides).toEqual({ visual: 'left' })
    expect(restored.noticedNodeIds).toEqual(['visual'])
    expect(restored.history).toHaveLength(1)
    expect(restored.history![0].selectedId).toBe('layout')
    expect(restored.scenes![0].positions).not.toHaveProperty('foreign')
  })
  it('多视图与聚焦历史持久化和导出恢复，研究数据及模型实际输入保持不变', () => {
    const db = store(),
      before = db.snapshot(),
      workspace = 'welcome-research',
      inputs = buildContext(before, 'layout', '继续研究').messages
    let view = { ...before.views[workspace], selectedId: 'visual' }
    for (const action of [
      {
        type: 'scene',
        patch: {
          viewport: { x: 44, y: -32, zoom: 0.8 },
          positions: { visual: { x: 231, y: 118 } },
        },
      },
      { type: 'focus', nodeId: 'visual' },
      { type: 'mode', mode: 'mindmap' },
      { type: 'detail', detail: 'compact' },
      { type: 'scene', patch: { viewport: { x: 0, y: 22, zoom: 1 } } },
      { type: 'mode', mode: 'horizontal' },
      { type: 'scene', patch: { viewport: { x: 7, y: 31, zoom: 0.85 } } },
    ] as const)
      view = { ...view, ...transitionView(before.nodes, view, action) }
    db.saveView(workspace, {
      ...view,
      graph: { ...view.graph, noticedNodeIds: [before.workspaces[0].rootId, 'visual'] },
    })
    const saved = db.snapshot(),
      copy = store(false)
    copy.importWorkspace(db.exportWorkspace(workspace))
    expect(copy.snapshot().views[workspace]).toEqual(saved.views[workspace])
    expect(copy.snapshot().views[workspace].graph?.noticedNodeIds).toEqual([
      before.workspaces[0].rootId,
      'visual',
    ])
    expect(graphPresentation(copy.snapshot().views[workspace]).scene.viewport).toEqual({
      x: 7,
      y: 31,
      zoom: 0.85,
    })
    expect(buildContext(saved, 'layout', '继续研究').messages).toEqual(inputs)
    for (const field of ['nodes', 'reports', 'runs', 'messages'] as const)
      expect(saved[field]).toEqual(before[field])
  })
  it('节点阅读位置、报告版本和两种草稿在保存、导出恢复后仍各自保留', () => {
    const db = store(),
      view = db.snapshot().views['welcome-research']
    db.saveView('welcome-research', {
      ...view,
      selectedId: 'visual',
      viewport: { x: 1, y: 2, zoom: 0.012 },
      drafts: { visual: '尚未发送的研究指令' },
      chatDrafts: { visual: '尚未发送的对话' },
      readers: {
        visual: {
          tab: 'report',
          reportId: 'report-visual',
          scroll: { 'report:report-visual': 842, 'chat:': 129 },
          composerOpen: false,
          overviewOpen: true,
        },
        context: { tab: 'sources', scroll: { 'sources:report-context': 219 } },
        'unknown-node': { tab: 'chat' },
      },
    })
    const saved = db.snapshot().views['welcome-research']
    expect(saved.readers?.visual?.scroll?.['report:report-visual']).toBe(842)
    expect(saved.readers?.context?.tab).toBe('sources')
    expect(saved.readers).not.toHaveProperty('unknown-node')
    const copy = store(false)
    copy.importWorkspace(db.exportWorkspace('welcome-research'))
    expect(copy.snapshot().views['welcome-research']).toEqual(saved)
  })
  it('承接当前路径的报告，其他分支不会默认混入', () => {
    const db = store(),
      snapshot = db.snapshot()
    snapshot.reports.find((r) => r.nodeId === 'context')!.markdown = 'SIBLING_ONLY_MARKER'
    const pack = buildContext(snapshot, 'layout', '关注稳定性')
    expect(pack.path).toEqual(['root', 'visual', 'layout'])
    expect(pack.items.map((i) => i.reportId)).toEqual(['report-visual', 'report-root'])
    expect(pack.messages[1].content).not.toContain('SIBLING_ONLY_MARKER')
    expect(pack.messages.at(-1)?.content).toContain('关注稳定性')
    expect(pack.estimatedTokens).toBeLessThanOrEqual(pack.budget)
  })
  it('用户可明确引用另一条分支的具体报告', () => {
    const db = store(),
      pack = buildContext(db.snapshot(), 'layout', '比较这两个方向', ['report-context'])
    expect(pack.items.find((i) => i.reportId === 'report-context')?.reason).toBe('用户明确指定')
    expect(pack.items.every((i) => i.included)).toBe(true)
  })
  it('相关研究会进入上下文，并说明纳入原因', () => {
    const db = store(),
      pack = buildContext(db.snapshot(), 'budget', '')
    expect(pack.items.find((i) => i.reportId === 'report-visual')?.reason).toBe(
      '当前节点关联的研究',
    )
  })
  it('超长报告采用摘要，超预算的必需信息明确报错', () => {
    const db = store(),
      snapshot = db.snapshot()
    snapshot.settings.contextBudget = 4000
    snapshot.reports.find((r) => r.nodeId === 'visual')!.markdown = '长报告'.repeat(5000)
    const pack = buildContext(snapshot, 'layout', '')
    expect(pack.items.find((i) => i.reportId === 'report-visual')?.excerpted).toBe(true)
    expect(pack.estimatedTokens).toBeLessThanOrEqual(4000)
    snapshot.workspaces[0].constraints = '约束'.repeat(6000)
    expect(() => buildContext(snapshot, 'layout', '')).toThrow('超出上下文预算')
  })
  it('拒绝循环及缺失的祖先，避免错误恢复上下文', () => {
    const db = store(),
      nodes = db.snapshot().nodes
    nodes.find((n) => n.id === 'root')!.parentId = 'layout'
    expect(() => ancestorPath(nodes, 'layout')).toThrow('循环')
    nodes.find((n) => n.id === 'root')!.parentId = 'missing'
    expect(() => ancestorPath(nodes, 'layout')).toThrow('缺失父节点')
  })
})
describe('SQLite 研究历史与恢复', () => {
  it('原始报告不被继续研究覆盖，后续方向只追加一次', () => {
    const db = store(),
      original = db.snapshot().reports.find((r) => r.id === 'report-visual')!,
      r = run(db)
    db.saveRun({ ...r, output: JSON.stringify(output) })
    const id = db.complete(r.id, output)
    const snapshot = db.snapshot()
    expect(snapshot.reports.find((r) => r.id === 'report-visual')).toEqual(original)
    expect(snapshot.reports.find((r) => r.id === id)?.nodeId).toBe('visual')
    expect(snapshot.nodes.find((n) => n.originReportId === id)?.parentId).toBe('visual')
    expect(db.complete(r.id, output)).toBe(id)
    expect(db.snapshot().reports).toHaveLength(4)
  })
  it('取消后不能追加报告或子方向', () => {
    const db = store(),
      r = run(db)
    db.saveRun({ ...r, status: 'cancelled' })
    expect(() => db.complete(r.id, output)).toThrow('已结束')
    expect(db.snapshot().nodes).toHaveLength(8)
    expect(db.snapshot().reports).toHaveLength(3)
  })
  it('重开恢复问题、视图与草稿，将未完成运行标为中断', () => {
    const first = store(),
      workspace = first.createWorkspace('一个新的研究问题'),
      root = first.snapshot().workspaces.find((w) => w.id === workspace)!.rootId
    first.insertReport({
      ...first.report('report-root'),
      id: 'new-root-report',
      workspaceId: workspace,
      nodeId: root,
    })
    const child = first.createNode(root, '深入某个角度', 'new-root-report')
    first.saveView(workspace, {
      selectedId: child,
      collapsed: [],
      drafts: { [child]: '恢复后继续' },
      viewport: { x: 12, y: 34, zoom: 0.8 },
    })
    first.saveRun(run(first))
    const directory = first.directory
    first.close()
    stores.splice(stores.indexOf(first), 1)
    const reopened = new ResearchStore(directory)
    stores.push(reopened)
    expect(reopened.snapshot().views[workspace].drafts[child]).toBe('恢复后继续')
    expect(reopened.snapshot().runs[0].status).toBe('interrupted')
    expect(reopened.node(child).parentId).toBe(root)
  })
  it('后台导入连接不会将已有运行误判为应用重启中断', () => {
    const first = store(),
      research = run(first)
    first.saveRun(research)
    const importer = new ResearchStore(first.directory, { seed: false, recoverRuns: false })
    stores.push(importer)
    expect(importer.run(research.id).status).toBe('running')
    expect(first.run(research.id)).toEqual(research)
  })
  it('导出与导入完整保留报告、原始输出、来源、修订和视图', () => {
    const first = store(),
      r = run(first)
    first.saveRun({ ...r, output: JSON.stringify(output) })
    first.complete(r.id, output)
    first.editNode('visual', '调整后的研究问题')
    first.saveView('welcome-research', {
      selectedId: 'visual',
      collapsed: ['context'],
      drafts: { visual: '下一步' },
    })
    const data = first.exportWorkspace('welcome-research'),
      second = store(false)
    second.importWorkspace(data)
    expect(second.exportWorkspace('welcome-research')).toEqual(data)
    expect(data.edits[0].previous.question).toBe('研究画布与思考路径')
    expect(() => second.importWorkspace(data)).toThrow('已存在')
  })
  it('无效导入整体失败，不留下半个研究空间', () => {
    const first = store(),
      data = first.exportWorkspace('welcome-research'),
      second = store(false)
    data.nodes.find((n) => n.id === 'visual')!.parentId = 'layout'
    expect(() => second.importWorkspace(data)).toThrow('循环')
    expect(second.snapshot().nodes).toHaveLength(0)
    expect(second.snapshot().workspaces).toHaveLength(0)
  })
  it('迟到的视图保存不会覆盖新草稿', () => {
    const db = store()
    db.saveView('welcome-research', {
      selectedId: 'visual',
      collapsed: [],
      drafts: { visual: '最新草稿' },
      revision: 200,
    })
    db.saveView('welcome-research', {
      selectedId: 'context',
      collapsed: [],
      drafts: { visual: '过期草稿' },
      revision: 100,
    })
    expect(db.snapshot().views['welcome-research'].drafts.visual).toBe('最新草稿')
    expect(db.snapshot().views['welcome-research'].selectedId).toBe('visual')
  })
  it('密钥加密保存，不进入快照或导出；换服务地址后不复用旧密钥', () => {
    const db = store(),
      settings = {
        ...defaultSettings,
        modelContextWindow: 128000,
        sessionStrategy: 'portable' as const,
        provider: 'compatible' as const,
        modelProvider: 'custom',
        baseUrl: 'http://127.0.0.1:8999/v1',
        model: 'fixture-model',
        apiKey: 'fixture-secret-key',
        searchKey: 'fixture-search-key',
      }
    db.saveSettings(settings)
    expect(db.credentials().apiKey).toBe('fixture-secret-key')
    expect(db.settings().hasApiKey).toBe(true)
    expect(JSON.stringify(db.snapshot())).not.toContain('fixture-secret')
    expect(JSON.stringify(db.exportWorkspace('welcome-research'))).not.toContain('fixture-secret')
    expect(
      readFileSync(join(db.directory, 'research.sqlite')).includes(
        Buffer.from('fixture-secret-key'),
      ),
    ).toBe(false)
    db.saveSettings({ ...settings, baseUrl: 'http://127.0.0.1:9999/v1', apiKey: '', searchKey: '' })
    expect(db.credentials().apiKey).toBe('')
    expect(db.settings().hasApiKey).toBe(false)
  })
})
// Real SDK calls and upgrade backups use the integration budget, not the unit default.
describe('真实协议接口与运行生命周期', { timeout: 20000 }, () => {
  it('开始 A 研究后切换 B 焦点，完成报告仍归 A', async () => {
    const db = store(),
      service = new ResearchService(db)
    db.saveSettings({
      ...defaultSettings,
      modelContextWindow: 128000,
      sessionStrategy: 'portable' as const,
      provider: 'compatible',
      modelProvider: 'custom',
      baseUrl: 'http://127.0.0.1:8999/v1',
      model: 'fixture-model',
    })
    let finish!: (value: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve
          }),
      ),
    )
    const result = await service.command({
      type: 'start-research',
      nodeId: 'visual',
      instruction: '只研究 A',
    })
    db.saveView('welcome-research', {
      selectedId: 'context',
      collapsed: [],
      drafts: { context: 'B 的草稿' },
    })
    // First use now completes an actual online database backup before sending the request.
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'), { timeout: 15000 })
    finish(apiStream('openai-chat', JSON.stringify(output)))
    await vi.waitFor(() => expect(db.run(result.id!).status).toBe('completed'))
    const snapshot = db.snapshot()
    expect(snapshot.reports.filter((r) => r.nodeId === 'visual')).toHaveLength(2)
    expect(snapshot.reports.filter((r) => r.nodeId === 'context')).toHaveLength(1)
    expect(snapshot.views['welcome-research'].selectedId).toBe('context')
    expect(snapshot.runs[0].context.items.every((i) => i.nodeId !== 'context')).toBe(true)
    service.shutdown()
  })
  it('无效模型输出保存原文，失败时不产生半份报告', async () => {
    const db = store(),
      service = new ResearchService(db)
    db.saveSettings({
      ...defaultSettings,
      modelContextWindow: 128000,
      sessionStrategy: 'portable' as const,
      provider: 'compatible',
      modelProvider: 'custom',
      baseUrl: 'http://127.0.0.1:8999/v1',
      model: 'fixture-model',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => apiStream('openai-chat', '这不是约定的 JSON 报告')),
    )
    const result = await service.command({
      type: 'start-research',
      nodeId: 'visual',
      instruction: '',
    })
    await vi.waitFor(() => expect(db.run(result.id!).status).toBe('failed'), { timeout: 15000 })
    expect(db.run(result.id!).output).toBe('这不是约定的 JSON 报告')
    expect(db.snapshot().reports).toHaveLength(3)
    expect(db.snapshot().nodes).toHaveLength(8)
    service.shutdown()
  })
  it('取消运行后，即使模型迟到返回，也不能把结果写进研究', async () => {
    const db = store(),
      service = new ResearchService(db)
    db.saveSettings({
      ...defaultSettings,
      modelContextWindow: 128000,
      sessionStrategy: 'portable' as const,
      provider: 'compatible',
      modelProvider: 'custom',
      baseUrl: 'http://127.0.0.1:8999/v1',
      model: 'fixture-model',
    })
    let finish!: (value: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve
          }),
      ),
    )
    const result = await service.command({
      type: 'start-research',
      nodeId: 'layout',
      instruction: '',
    })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'), { timeout: 15000 })
    await service.command({ type: 'cancel-research', runId: result.id! })
    finish(apiStream('openai-chat', JSON.stringify(output)))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(db.run(result.id!).status).toBe('cancelled')
    expect(db.run(result.id!).output).toBe('')
    expect(db.snapshot().reports).toHaveLength(3)
    service.shutdown()
  })
  it('连接失败保留服务状态码，便于在设置里诊断', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":{"message":"模型不可用"}}', { status: 401 })),
    )
    const db = store()
    await expect(
      new ResearchService(db).testConnection({
        ...defaultSettings,
        modelContextWindow: 128000,
        sessionStrategy: 'portable' as const,
        provider: 'compatible',
        modelProvider: 'custom',
        baseUrl: 'http://127.0.0.1:8999/v1',
      }),
    ).rejects.toThrow('HTTP 401')
  })
})
