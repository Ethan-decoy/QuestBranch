import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, relative, sep } from 'node:path'
import { AcpAgents } from '../src/desktop/acp-agent'
import { ResearchStore } from '../src/desktop/store'
import { ResearchService } from '../src/desktop/service'
import { buildContext } from '../src/research/context'
import type { AgentConfig, AgentRun } from '../src/research/agent'

const resources: {
  runtime: AcpAgents
  store: ResearchStore
  directory: string
  service: ResearchService
}[] = []
function setup(scenario = 'normal', seed = true, relativeDirectory = false) {
  const parent = relativeDirectory ? resolve('artifacts/acp-integration') : tmpdir()
  if (relativeDirectory) mkdirSync(parent, { recursive: true })
  const directory = mkdtempSync(join(parent, 'qb-acp-test-'))
  const store = new ResearchStore(directory, { seed })
  const runtime = new AcpAgents(relativeDirectory ? relative(process.cwd(), directory) : directory)
  const config: AgentConfig = {
    kind: 'custom',
    command: process.execPath,
    args: [resolve('tests/fixtures/acp-agent.mjs'), scenario],
  }
  store.saveSettings({ ...store.settings(), backend: 'acp', agent: config, model: '' })
  const service = new ResearchService(store, undefined, runtime)
  const resource = { runtime, store, directory, service }
  resources.push(resource)
  return { ...resource, config }
}
async function until<T>(read: () => T | Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const end = Date.now() + 8000
  while (Date.now() < end) {
    const value = await read()
    if (ready(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('ACP fixture timed out')
}
afterEach(async () => {
  for (const { runtime, store, directory, service } of resources.splice(0)) {
    service.shutdown()
    runtime.shutdown()
    store.close()
    if (
      !(
        resolve(directory).startsWith(resolve(tmpdir()) + sep) ||
        resolve(directory).startsWith(resolve('artifacts/acp-integration') + sep)
      ) ||
      !basename(directory).startsWith('qb-acp-test-')
    )
      throw new Error('Unexpected cleanup path')
    // Windows may retain the child working directory while shutdown completes.
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
describe('ACP 原生智能体接入', () => {
  it.each(['mcp-resume', 'session-load'])(
    '%s 同节点持续恢复、跨节点隔离、重连研究工具；历史回放不成为本轮回复',
    async (scenario) => {
      const { service, store, directory } = setup(scenario)
      const send = async (nodeId: string, message: string) => {
        const { id } = await service.command({ type: 'send-message', nodeId, message })
        const run = await until(
          () => store.run(id!),
          (run) => run.status !== 'running',
        )
        expect(run.status, run.error).toBe('completed')
        return run
      }
      const first = await send('visual', 'FIRST_NODE_ONLY')
      const other = await send('context', 'OTHER_NODE_ONLY')
      const next = await send('visual', 'CURRENT_FOLLOWUP_ONLY')
      expect(next.agent!.sessionId).toBe(first.agent!.sessionId)
      expect(other.agent!.sessionId).not.toBe(first.agent!.sessionId)
      expect(next.agent!.sessionOrigin).toBe(scenario === 'session-load' ? 'loaded' : 'resumed')
      expect(next.output).toBe('CURRENT_TURN_ONLY')
      expect(next.agent!.activities).toHaveLength(0)
      expect(next.agent!.usage).toMatchObject({
        contextTokens: 1200,
        contextWindow: 128000,
        cost: { amount: 0.02, currency: 'USD' },
      })
      const sessions = JSON.parse(
        readFileSync(join(directory, 'agent-workspace', 'fixture-sessions.json'), 'utf8'),
      )
      const prompts = sessions[first.agent!.sessionId!].prompts
      expect(prompts).toHaveLength(2)
      expect(prompts[1].text).toBe('[user]\nCURRENT_FOLLOWUP_ONLY')
      expect(prompts[1].text).not.toContain('FIRST_NODE_ONLY')
      if (scenario === 'mcp-resume')
        expect(prompts.map((p: { nodeId: string }) => p.nodeId)).toEqual(['visual', 'visual'])
      const source = store.snapshot().reports.find((report) => report.nodeId === 'visual')!
      store.createNode('visual', 'MATERIAL_UPDATE_ONLY', source.id)
      const updated = await send('visual', 'AFTER_UPDATE_ONLY')
      expect(updated.agent!.input!.materials).toMatchObject({
        included: true,
        historyIncluded: false,
      })
      expect(updated.agent!.input!.request.content[0].text).toContain('MATERIAL_UPDATE_ONLY')
      expect(updated.agent!.input!.request.content[0].text).not.toContain('FIRST_NODE_ONLY')
    },
    30000,
  )

  it('恢复失败不静默另建会话，明确重建后才新建；旧研究仍保留', async () => {
    const { service, store, directory } = setup('session-failure')
    const send = async () => {
      const { id } = await service.command({
        type: 'send-message',
        nodeId: 'visual',
        message: '继续',
      })
      return until(
        () => store.run(id!),
        (run) => run.status !== 'running',
      )
    }
    const first = await send(),
      failed = await send()
    expect(first.status).toBe('completed')
    expect(failed.status).toBe('failed')
    expect(failed.recovery).toBe('agent-session')
    expect(
      Object.keys(
        JSON.parse(
          readFileSync(join(directory, 'agent-workspace', 'fixture-sessions.json'), 'utf8'),
        ),
      ),
    ).toHaveLength(1)
    await service.command({ type: 'reset-agent-session', nodeId: 'visual' })
    const rebuilt = await send()
    expect(rebuilt.status).toBe('completed')
    expect(rebuilt.agent!.sessionId).not.toBe(first.agent!.sessionId)
    expect(store.run(first.id).output).toBe('CURRENT_TURN_ONLY')
  }, 30000)
  it.each(['mcp-http', 'mcp-stdio'])(
    '通过 %s 注入真实 MCP 工具，直接保存并返回分支，重复调用一致',
    async (scenario) => {
      const { service, store, directory } = setup(scenario)
      store.insertReport({ ...store.report('report-visual'), id: 'visual-new', title: '新版报告' })
      // The persisted reader can lag behind a just-selected UI version.
      store.saveView('welcome-research', {
        ...store.snapshot().views['welcome-research'],
        readers: { visual: { tab: 'report', reportId: 'visual-new' } },
      })
      const before = store.snapshot()
      const { id } = await service.command({
        type: 'send-message',
        nodeId: 'visual',
        message: '基于这份报告创建两个后续方向',
        selectedReportId: 'report-visual',
      })
      const run = await until(
        () => store.run(id!),
        (run) => run.status !== 'running',
      )
      expect(run.error).toBe('')
      expect(run.status).toBe('completed')
      expect(run.selectedReportId).toBe('report-visual')
      const evidence = JSON.parse(
        readFileSync(join(directory, 'agent-workspace', 'fixture-mcp.json'), 'utf8'),
      ) as { transport: string; nodeIds: string[]; selectedReportId: string; retried: boolean }
      expect(evidence.transport).toBe(scenario === 'mcp-http' ? 'http' : 'stdio')
      expect(evidence.retried).toBe(true)
      expect(evidence.nodeIds).toHaveLength(2)
      expect(evidence.selectedReportId).toBe('report-visual')
      expect(store.snapshot(before.version)?.nodes).toHaveLength(before.nodes.length + 2)
      expect(
        evidence.nodeIds
          .map((id) => store.node(id))
          .every((node) => node.parentId === 'visual' && node.originReportId === 'report-visual'),
      ).toBe(true)
      expect(
        run.agent?.activities.some(
          (activity) => activity.title === '创建研究方向' && activity.status === 'completed',
        ),
      ).toBe(true)
      expect(JSON.stringify(store.exportWorkspace('welcome-research'))).not.toContain(
        'QUESTBRANCH_MCP_TOKEN',
      )
    },
    30_000,
  )
  it('取消含 MCP 创建的研究会停止连接，已保存方向保留且不自动研究', async () => {
    const { service, store } = setup('mcp-wait')
    const { id } = await service.command({
      type: 'send-message',
      nodeId: 'visual',
      message: '创建后续方向',
    })
    await until(
      () => store.run(id!),
      (run) => !!run.agent?.requests.some((request) => request.status === 'pending'),
    )
    const created = store.snapshot().nodes.filter((node) => node.originReportId === 'report-visual')
    expect(created).toHaveLength(2)
    await service.command({ type: 'cancel-research', runId: id! })
    await until(
      () => service.hasActiveRuns,
      (active) => !active,
    )
    expect(store.run(id!).status).toBe('cancelled')
    expect(
      store.snapshot().nodes.filter((node) => created.some((child) => child.id === node.id)),
    ).toEqual(created)
    expect(
      store.snapshot().runs.filter((run) => created.some((node) => node.id === run.nodeId)),
    ).toHaveLength(0)
  })
  it('连接真实 stdio 协议，读取原生模型选项和命令', async () => {
    const { runtime, config } = setup('normal', true, true)
    const connection = await runtime.connect(config)
    expect(connection.status).toBe('connected')
    expect(connection.name).toBe('Fixture ACP')
    expect(connection.options[0].choices).toHaveLength(2)
    expect(connection.commands[0].name).toBe('skills')
    const configured = await runtime.configure(connection.id, 'model', 'fixture-deep')
    expect(configured.options[0].value).toBe('fixture-deep')
    await runtime.disconnect(connection.id)
    await expect(runtime.state(connection.id)).rejects.toThrow('连接已结束')
  })
  it('原生登录可回应、取消与重新连接，不复制账号凭据', async () => {
    const { runtime, config } = setup('auth')
    const connection = await runtime.connect(config)
    expect(connection.status).toBe('login-required')
    await runtime.authenticate(connection.id, 'device-code')
    // state() is asynchronous; wait for the request without touching any native credential.
    let request
    for (let i = 0; i < 80; i++) {
      request = (await runtime.state(connection.id)).requests.find(
        (request) => request.status === 'pending',
      )
      if (request) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(request?.title).toContain('QB-1234')
    await runtime.respond(connection.id, request!.id, { action: 'accept' })
    for (let i = 0; i < 80 && (await runtime.state(connection.id)).status === 'authenticating'; i++)
      await new Promise((resolve) => setTimeout(resolve, 25))
    expect((await runtime.state(connection.id)).status).toBe('connected')
    await runtime.disconnect(connection.id)
    expect((await runtime.connect(config)).status).toBe('connected')
  })
  it('节点对话保存工具进展和实际模型，原生权限由用户回应', async () => {
    const { service, store, runtime, config } = setup('permission')
    store.saveSettings({
      ...store.settings(),
      agent: { ...config, options: { model: 'fixture-deep' } },
    })
    const { id } = await service.command({
      type: 'send-message',
      nodeId: 'visual',
      message: '继续查资料',
    })
    const waiting = await until(
      () => store.run(id!),
      (run) => !!run.agent?.requests.some((request) => request.status === 'pending'),
    )
    const request = waiting.agent!.requests[0]
    expect(waiting.agent!.activities[0].status).toBe('in_progress')
    await expect(
      runtime.respond(request.connectionId, request.id, { optionId: 'invented' }),
    ).rejects.toThrow('请选择')
    await runtime.respond(request.connectionId, request.id, { optionId: 'once' })
    const run = await until(
      () => store.run(id!),
      (run) => run.status !== 'running',
    )
    expect(run.status).toBe('completed')
    expect(run.model).toBe('fixture-deep')
    expect(run.agent!.sessionId).toBeTruthy()
    expect(run.agent!.configuration?.model).toBe('fixture-deep')
    expect(run.agent!.activities[0].status).toBe('completed')
    expect(run.output).toContain('正在查阅资料。')
    expect(JSON.stringify(run.agent)).not.toContain('RAW_DEBUG_ONLY')
    expect(
      store
        .snapshot()
        .messages.find((message) => message.runId === id && message.role === 'assistant')?.content,
    ).toContain('fixture-deep')
  })
  it('ACP 对话中的保存工具保留节点归属、真实报告与子分支，不另起报告运行', async () => {
    const { service, store } = setup('mcp-save')
    const parent = store.snapshot().workspaces[0].rootId
    const source = store.snapshot().reports.find((report) => report.nodeId === parent)!
    const child = store.createNode(parent, '没有自身报告的研究', source.id)
    const { id } = await service.command({
      type: 'send-message',
      nodeId: child,
      message: '构建明确的后续分支',
    })
    const run = await until(
      () => store.run(id!),
      (run) => run.status !== 'running',
    )
    expect(run.status, run.error).toBe('completed')
    const reports = store.snapshot().reports.filter((report) => report.nodeId === child)
    expect(reports).toHaveLength(1)
    expect(reports[0].runId).toBe(id)
    expect(store.snapshot().nodes.find((node) => node.parentId === child)?.originReportId).toBe(
      reports[0].id,
    )
    expect(reports[0].sources.at(-1)?.excerpt).toContain('未独立核验')
    expect(run.agent?.activities[0].status).toBe('completed')
    expect(run.mode).toBe('chat')
    expect(run.reportId).toBeUndefined()
  })
  it.each(['normal', 'delayed-start'])(
    '报告保留智能体新来源、活动与会话引用，导出恢复不丢失（%s）',
    async (scenario) => {
      const { service, store } = setup(scenario)
      const { id } = await service.command({
        type: 'start-research',
        nodeId: 'visual',
        instruction: '研究并保存报告',
      })
      const run = await until(
        () => store.run(id!),
        (run) => run.status !== 'running',
      )
      expect(run.error).toBe('')
      expect(run.status).toBe('completed')
      expect(
        run.context.sources.some((source) => source.url === 'https://example.com/research'),
      ).toBe(false)
      const report = store.snapshot().reports.find((report) => report.runId === id)!
      expect(
        report.sources.some(
          (source) =>
            source.url === 'https://example.com/research' && source.excerpt.includes('未独立核验'),
        ),
      ).toBe(true)
      const exported = store.exportWorkspace(run.workspaceId)
      const restored = setup('normal', false).store
      restored.importWorkspace(exported)
      expect(restored.run(id!).agent).toEqual(run.agent)
      expect(restored.snapshot().reports.find((item) => item.id === report.id)).toEqual(report)
      // Real process startup plus export/import can outlast Vitest's 5s unit-test default.
      // Keep until()'s 8s protocol bound and every persistence assertion unchanged.
    },
    15_000,
  )
  it('取消待回应工具请求后结束进程，晚到事件不能写成完成', async () => {
    const { service, store, runtime } = setup('cancel')
    const { id } = await service.command({
      type: 'send-message',
      nodeId: 'visual',
      message: '检索',
    })
    const waiting = await until(
      () => store.run(id!),
      (run) => !!run.agent?.requests.length,
    )
    const request = waiting.agent!.requests[0]
    await service.command({ type: 'cancel-research', runId: id! })
    await until(
      () => service.hasActiveRuns,
      (active) => !active,
    )
    expect(store.run(id!).status).toBe('cancelled')
    await expect(runtime.state(request.connectionId)).rejects.toThrow('连接已结束')
    expect(store.snapshot().reports.some((report) => report.runId === id)).toBe(false)
  })
  it('进程意外退出会失败留存，不持续等待', async () => {
    const { service, store } = setup('exit')
    const { id } = await service.command({
      type: 'send-message',
      nodeId: 'visual',
      message: '中断测试',
    })
    const run = await until(
      () => store.run(id!),
      (run) => run.status !== 'running',
    )
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/进程已退出|连接已关闭/)
  })
  it('原生斜杠命令透传，不被研究上下文前缀遮蔽', async () => {
    const { runtime, store, config } = setup()
    let last: AgentRun | undefined
    const result = await runtime.run(
      config,
      buildContext(store.snapshot(), 'visual', '/skills', [], 'chat'),
      new AbortController().signal,
      (_, agent) => {
        last = agent
      },
    )
    expect(result.raw).toContain('原生技能')
    expect(last?.sessionId).toBeTruthy()
  })
  it('登录等待可直接关闭，重连不误认为已登录', async () => {
    const { runtime, config } = setup('auth')
    const connection = await runtime.connect(config)
    await runtime.authenticate(connection.id, 'device-code')
    await until(
      () => runtime.state(connection.id),
      (state) => state.requests.length > 0,
    )
    await runtime.disconnect(connection.id)
    expect((await runtime.connect(config)).status).toBe('login-required')
  })
  it('连接启动阶段也可取消，不遗留等待中的进程', async () => {
    const { runtime, config } = setup('startup')
    const abort = new AbortController()
    const connecting = runtime.connect(config, abort.signal)
    setTimeout(() => abort.abort(), 120)
    await expect(connecting).rejects.toThrow()
  })
  it('缺失可执行程序会明确失败，不等待协议超时', async () => {
    const { runtime, config } = setup()
    await expect(
      runtime.connect({ ...config, command: join(tmpdir(), 'qb-acp-no-such-program.exe') }),
    ).rejects.toThrow(/ENOENT|退出|连接/)
  })
  it('原生 Markdown 报告可保存，未产生结构化结论时不编造分支', async () => {
    const { service, store } = setup('markdown')
    const before = store.snapshot().nodes.length
    const { id } = await service.command({
      type: 'start-research',
      nodeId: 'visual',
      instruction: '整理',
    })
    const run = await until(
      () => store.run(id!),
      (run) => run.status !== 'running',
    )
    expect(run.status).toBe('completed')
    expect(store.snapshot().reports.find((report) => report.runId === id)?.markdown).toMatch(
      /^# 原生 Markdown/,
    )
    expect(store.snapshot().nodes.length).toBe(before)
  })
  it('不完整 JSON 不伪装成 Markdown 完成报告', async () => {
    const { service, store } = setup('invalid')
    const { id } = await service.command({
      type: 'start-research',
      nodeId: 'visual',
      instruction: '整理',
    })
    const run = await until(
      () => store.run(id!),
      (run) => run.status !== 'running',
    )
    expect(run.status).toBe('failed')
    expect(run.output).toContain('不完整')
    expect(store.snapshot().reports.some((report) => report.runId === id)).toBe(false)
  })
})
