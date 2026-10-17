import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ResearchStore } from '../src/desktop/store'
import { ResearchService } from '../src/desktop/service'
import { ancestorPath, buildContext } from '../src/research/context'
import { generate, listModels } from '../src/research/providers'
import { defaultSettings, type ResearchRun, type ResearchOutput } from '../src/research/types'

const stores: ResearchStore[] = [],
  directories: string[] = []
function store(seed = true) {
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
function sse(data: string) {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: data } }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}
afterEach(() => {
  vi.unstubAllGlobals()
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

describe('可追溯的分支上下文', () => {
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
    expect(() => db.complete(r.id, output)).toThrow('已结束')
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
      root = first.snapshot().workspaces.find((w) => w.id === workspace)!.rootId,
      child = first.createNode(root, '深入某个角度')
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
describe('真实协议接口与运行生命周期', () => {
  it('兼容接口采用真实请求格式，解析跨字节的 SSE 文本', async () => {
    const encoded = new TextEncoder().encode(
        `data: ${JSON.stringify({ choices: [{ delta: { content: '中文报告' } }] })}\n\ndata: [DONE]\n\n`,
      ),
      fetcher = vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(encoded.slice(0, 51))
                controller.enqueue(encoded.slice(51))
                controller.close()
              },
            }),
          ),
      )
    vi.stubGlobal('fetch', fetcher)
    const result = await generate(
      { ...defaultSettings, model: 'fixture-model', jsonMode: true },
      'test-key',
      [{ role: 'user', content: '研究问题' }],
      new AbortController().signal,
      () => {},
    )
    expect(result).toBe('中文报告')
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(JSON.parse(init.body as string).response_format).toEqual({ type: 'json_object' })
  })
  it('Ollama 使用独立接口和逐行流，不绑定云厂商', async () => {
    const fetcher = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          '{"message":{"content":"本地"},"done":false}\n{"message":{"content":"研究"},"done":true}\n',
        ),
    )
    vi.stubGlobal('fetch', fetcher)
    const settings = {
      ...defaultSettings,
      provider: 'ollama' as const,
      baseUrl: 'http://127.0.0.1:11434',
      model: 'local',
    }
    expect(
      await generate(
        settings,
        '',
        [{ role: 'user', content: '问题' }],
        new AbortController().signal,
        () => {},
      ),
    ).toBe('本地研究')
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/chat')
  })
  it('开始 A 研究后切换 B 焦点，完成报告仍归 A', async () => {
    const db = store(),
      service = new ResearchService(db)
    db.saveSettings({
      ...defaultSettings,
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
    finish(sse(JSON.stringify(output)))
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
      baseUrl: 'http://127.0.0.1:8999/v1',
      model: 'fixture-model',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sse('这不是约定的 JSON 报告')),
    )
    const result = await service.command({
      type: 'start-research',
      nodeId: 'visual',
      instruction: '',
    })
    await vi.waitFor(() => expect(db.run(result.id!).status).toBe('failed'))
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
    await service.command({ type: 'cancel-research', runId: result.id! })
    finish(sse(JSON.stringify(output)))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(db.run(result.id!).status).toBe('cancelled')
    expect(db.run(result.id!).output).toBe(JSON.stringify(output))
    expect(db.snapshot().reports).toHaveLength(3)
    service.shutdown()
  })
  it('连接失败保留服务状态码，便于在设置里诊断', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":{"message":"模型不可用"}}', { status: 404 })),
    )
    await expect(listModels(defaultSettings, '')).rejects.toThrow('HTTP 404：模型不可用')
  })
})
