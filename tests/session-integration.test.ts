import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Context,
} from '@earendil-works/pi-ai'
import { SessionWeave } from 'sessionweave'
import { ResearchStore } from '../src/desktop/store'
import { ResearchService } from '../src/desktop/service'
import { PiModels } from '../src/desktop/pi-models'
import { relocateResearchStorage } from '../src/desktop/storage-location'
import { buildContext } from '../src/research/context'
import type { ResearchRun } from '../src/research/types'
import { apiStream } from './fixtures/api-stream'

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close()
  vi.restoreAllMocks()
})
function setup(contextWindow = 128000) {
  const directory = mkdtempSync(join(tmpdir(), 'qb-session-'))
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  const store = new ResearchStore(join(directory, 'data'))
  cleanup.push(() => store.close())
  const faux = fauxProvider({
    provider: 'fixture-session',
    models: [{ id: 'fixture', contextWindow, maxTokens: 8192 }],
    tokensPerSecond: Infinity,
  })
  store.saveSettings({
    ...store.settings(),
    provider: 'compatible',
    modelProvider: faux.provider.id,
    model: 'fixture',
    baseUrl: '',
    apiKey: 'fixture-secret',
    sessionStrategy: 'portable',
  })
  const runtime = new PiModels(store, { providers: [faux.provider] })
  const service = new ResearchService(store, runtime)
  cleanup.push(() => service.shutdown())
  const root = store.snapshot().workspaces[0].rootId
  return { directory, store, faux, service, root }
}
async function send(
  service: ResearchService,
  store: ResearchStore,
  nodeId: string,
  message: string,
) {
  const { id } = await service.command({ type: 'send-message', nodeId, message })
  await vi.waitFor(() => expect(store.run(id!).status).not.toBe('running'), { timeout: 15000 })
  const run = store.run(id!)
  expect(run.status, run.error).toBe('completed')
  return run
}
it('同节点多轮、跨节点、关闭重开稳定归属；原文不会重复追加', async () => {
  const { store, service, faux, root, directory } = setup()
  const report = store.snapshot().reports.find((report) => report.nodeId === root)!
  const child = store.createNode(root, '独立节点', report.id)
  faux.setResponses([
    fauxAssistantMessage('A 的第一轮'),
    fauxAssistantMessage('B 的独立讨论'),
    fauxAssistantMessage('A 的第二轮'),
  ])
  const a = await send(service, store, root, 'A-secret-evidence')
  const b = await send(service, store, child, 'B-secret-evidence')
  const a2 = await send(service, store, root, '继续 A')
  expect(a.session!.sessionId).toBe(a2.session!.sessionId)
  expect(b.session!.sessionId).not.toBe(a.session!.sessionId)
  expect(JSON.stringify(a2.session!.requests)).toContain('A-secret-evidence')
  expect(JSON.stringify(a2.session!.requests)).not.toContain('B-secret-evidence')
  expect(JSON.stringify(b.session!.requests)).not.toContain('A-secret-evidence')
  expect((await store.sessions.load(a.session!.sessionId))!.messages).toHaveLength(4)
  service.shutdown()
  const reopened = new ResearchStore(join(directory, 'data'), { seed: false })
  cleanup.push(() => reopened.close())
  const next = new ResearchService(reopened, new PiModels(reopened, { providers: [faux.provider] }))
  cleanup.push(() => next.shutdown())
  faux.setResponses([fauxAssistantMessage('重开后的继续')])
  const a3 = await send(next, reopened, root, '重开继续')
  expect(a3.session!.sessionId).toBe(a.session!.sessionId)
  expect((await reopened.sessions.load(a.session!.sessionId))!.messages).toHaveLength(6)
})

it('真实 OM SDK 通过 Pi 模型桥接压缩旧记录并恢复检查点；不预裁 16K 历史', async () => {
  const { store, service, faux, root } = setup(32000)
  const legacyIds: string[] = []
  for (let i = 0; i < 8; i++) {
    const id = `legacy-${i}`
    const run: ResearchRun = {
      id,
      workspaceId: 'welcome-research',
      nodeId: root,
      mode: 'chat',
      instruction: `原始输入 ${i} ` + 'evidence '.repeat(500),
      output: `完整答复 ${i} ` + 'relationship '.repeat(500),
      status: 'completed',
      phase: '完成',
      error: '',
      model: 'fixture',
      context: buildContext(store.snapshot(), root, '历史', [], 'chat'),
      createdAt: new Date().toISOString(),
    }
    store.saveRun(run)
    legacyIds.push(`${id}-user`, `${id}-assistant`)
  }
  let observations = 0
  const response = (context: Context) => {
    if (context.messages.some((message) => message.role === 'system' && message.toolsAdded?.length))
      return fauxAssistantMessage('根据会话记忆继续。')
    observations++
    return fauxAssistantMessage(
      '<observations>\n* 🔴 (09:00) 保留原始研究约束、版本与证据关系。\n</observations>\n<current-task>继续研究。</current-task>',
    )
  }
  faux.setResponses(Array.from({ length: 45 }, () => response))
  const first = await send(service, store, root, '承接所有已有讨论')
  const state = (await store.sessions.load(first.session!.sessionId))!
  expect(state.messages.slice(0, 16).map((message) => message.id)).toEqual(legacyIds)
  expect(first.session!.bootstrapMessageIds).toEqual(legacyIds)
  expect(observations).toBeGreaterThan(0)
  expect(state.workingMemoryCheckpoints!.at(-1)!.identity.policy).toContain('research-retention@2')
  const observed = observations
  const second = await send(service, store, root, '短追问')
  expect(second.session!.requests[0].checkpointId).toBe(state.workingMemoryCheckpoints!.at(-1)!.id)
  expect(observations).toBe(observed)
  const reopened = await SessionWeave.open({ sessionId: state.sessionId, store: store.sessions })
  expect((await reopened.inspect()).messageCount).toBe(20)
  expect((await reopened.inspect()).workingMemoryCheckpoint!.id).toBe(
    second.session!.requests[0].checkpointId,
  )
  // A later compression failure cannot publish a partial generation over the prior checkpoint.
  await reopened.append(
    Array.from({ length: 12 }, (_, index) => ({
      id: `next-raw-${index}`,
      role: index % 2 ? ('assistant' as const) : ('user' as const),
      text: 'next evidence '.repeat(500),
    })),
  )
  const previous = (await store.sessions.load(state.sessionId))!
  faux.setResponses(
    Array.from({ length: 20 }, () =>
      fauxAssistantMessage('truncated observations', { stopReason: 'length' }),
    ),
  )
  const failed = await service.command({
    type: 'send-message',
    nodeId: root,
    message: '需要再次整理',
  })
  await vi.waitFor(() => expect(store.run(failed.id!).status).toBe('failed'), { timeout: 15000 })
  expect(store.run(failed.id!).error).toContain('OM_OUTPUT_INCOMPLETE')
  const retained = (await store.sessions.load(state.sessionId))!
  expect(retained.workingMemoryCheckpoints).toEqual(previous.workingMemoryCheckpoints)
  expect(retained.messages).toHaveLength(previous.messages.length + 1)
}, 30000)

it('原生 Responses 使用完整 wire JSON 和计数接口续传，鉴权错误不退回 OM', async () => {
  const { store, root } = setup()
  store.saveSettings({
    ...store.settings(),
    modelProvider: 'custom',
    baseUrl: 'https://fixture.invalid/v1',
    model: 'wire-fixture',
    modelContextWindow: 128000,
    apiProtocol: 'openai-responses',
    sessionStrategy: 'auto',
  })
  const requests: { url: string; body: Record<string, unknown> }[] = []
  let generated = 0,
    forbidden = false
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    const path = String(url),
      body = JSON.parse(String(init?.body))
    requests.push({ url: path, body })
    if (forbidden) return Response.json({ error: { code: 'invalid_api_key' } }, { status: 401 })
    if (path.endsWith('/input_tokens'))
      return Response.json({ object: 'response.input_tokens', input_tokens: 1000 })
    if (path.endsWith('/compact'))
      return Response.json({
        id: `cmp-${requests.length}`,
        object: 'response.compaction',
        output: [{ type: 'compaction', encrypted_content: 'opaque-compaction' }],
      })
    generated++
    return Response.json({
      id: `resp-${generated}`,
      status: 'completed',
      output: [
        { type: 'reasoning', encrypted_content: `opaque-${generated}`, summary: [] },
        {
          id: `msg-${generated}`,
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: `原生回复 ${generated}`, annotations: [] }],
        },
      ],
    })
  })
  const network = { fetch: transport, run: <T>(_scope: unknown, fn: () => T) => fn() }
  const runtime = new PiModels(store, { network })
  const service = new ResearchService(store, runtime)
  cleanup.push(() => service.shutdown())
  const first = await send(service, store, root, '第一轮原生')
  const second = await send(service, store, root, '第二轮原生')
  expect(second.session!.sessionId).toBe(first.session!.sessionId)
  expect(second.session!.requests[0]).toMatchObject({ strategy: 'native', origin: 'resumed' })
  const actorRequests = requests.filter((request) => request.url.endsWith('/responses'))
  expect(JSON.stringify(actorRequests[1].body.input)).toContain('opaque-1')
  expect(actorRequests[1].body.include).toEqual(['reasoning.encrypted_content'])
  const saved = (await store.sessions.load(first.session!.sessionId))!
  expect(saved.messages).toHaveLength(4)
  expect(saved.nativeCheckpoints).toHaveLength(2)
  expect(JSON.stringify(store.exportWorkspace('welcome-research'))).not.toContain('fixture-secret')
  forbidden = true
  const { id } = await service.command({ type: 'send-message', nodeId: root, message: '连接错误' })
  await vi.waitFor(() => expect(store.run(id!).status).toBe('failed'))
  expect(store.run(id!).error).toContain('401')
  expect((await store.sessions.load(saved.sessionId))!.nativeCheckpoints).toEqual(
    saved.nativeCheckpoints,
  )
  expect(generated).toBe(2)
})

it('unknown 不伪装为 unsupported；用户可明确选择 portable', async () => {
  const { store, root, faux } = setup()
  const runtime = new PiModels(store, { providers: [faux.provider] })
  const service = new ResearchService(store, runtime)
  cleanup.push(() => service.shutdown())
  store.saveSettings({ ...store.settings(), sessionStrategy: 'auto' })
  const { id } = await service.command({ type: 'send-message', nodeId: root, message: '未知能力' })
  await vi.waitFor(() => expect(store.run(id!).status).toBe('failed'))
  expect(faux.state.callCount).toBe(0)
  expect(store.run(id!).error).toContain('CAPABILITY_UNKNOWN')
  store.saveSettings({ ...store.settings(), sessionStrategy: 'portable' })
  faux.setResponses([fauxAssistantMessage('明确的 OM 选择')])
  await send(service, store, root, '显式继续')
})

it('实际分页报告和原文回读，已保存请求与真实结果组成完整工具组', async () => {
  const { store, service, faux, root } = setup()
  const report = store.snapshot().reports.find((report) => report.nodeId === root)!
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('qb_get_report', { report_id: report.id, max_chars: 200 }, { id: 'read-page' }),
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage(fauxToolCall('qb_read_session_raw', {}, { id: 'read-raw' }), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage('已阅读实际分页。'),
  ])
  const run = await send(service, store, root, '读取报告和原文')
  expect(run.toolCalls![0].result).toMatchObject({ next_offset: 200 })
  expect(run.toolCalls![1].result).toHaveProperty('page.source')
  const state = (await store.sessions.load(run.session!.sessionId))!
  expect(state.messages.map((message) => message.role)).toEqual([
    'user',
    'assistant',
    'tool',
    'assistant',
    'tool',
    'assistant',
  ])
  expect(JSON.stringify(run.session!.requests[2].request)).toContain('read-raw')
})

it('SQLite 迁移保留活动会话；导出恢复保留原始档案并建立独立身份', async () => {
  const { directory, store, service, faux, root } = setup()
  faux.setResponses([fauxAssistantMessage('迁移前的完整回答')])
  const run = await send(service, store, root, '迁移测试输入')
  const before = (await store.sessions.load(run.session!.sessionId))!
  const target = join(directory, 'target')
  mkdirSync(target)
  await relocateResearchStorage(store, join(directory, 'profile'), target)
  const relocated = new ResearchStore(target, { seed: false })
  cleanup.push(() => relocated.close())
  expect(await relocated.sessions.load(before.sessionId)).toEqual(before)
  const recovered = new ResearchStore(join(directory, 'recovered'), { seed: false })
  cleanup.push(() => recovered.close())
  recovered.importWorkspace(store.exportWorkspace('welcome-research'))
  const next = new ResearchService(
    recovered,
    new PiModels(recovered, { providers: [faux.provider] }),
  )
  cleanup.push(() => next.shutdown())
  recovered.saveSettings({ ...store.settings(), apiKey: 'fixture-secret' })
  faux.setResponses([fauxAssistantMessage('导入后继续')])
  const resumed = await send(next, recovered, root, '独立恢复')
  expect(resumed.session!.sessionId).not.toBe(before.sessionId)
  const current = (await recovered.sessions.load(resumed.session!.sessionId))!
  expect(current.messages.slice(0, 2).map((message) => message.text)).toEqual(
    before.messages.map((message) => message.text),
  )
  expect(recovered.exportWorkspace('welcome-research').modelSessions.archives).toHaveLength(1)
})

it('原生 Anthropic 根据同部署 Models 核实能力；工具结果和签名块原样续传', async () => {
  const { store, root } = setup()
  store.saveSettings({
    ...store.settings(),
    modelProvider: 'custom',
    baseUrl: 'https://claude.fixture.invalid',
    model: 'claude-fixture',
    modelContextWindow: 128000,
    apiProtocol: 'anthropic-messages',
    sessionStrategy: 'auto',
    apiKey: 'fixture-key',
  })
  const requests: Record<string, unknown>[] = []
  let generations = 0,
    supported: boolean | null = true
  const network = {
    fetch: vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes('/models/'))
        return Response.json({
          id: 'claude-fixture',
          capabilities: {
            compaction: supported === null ? null : { supported, summarize: { supported } },
          },
        })
      const body = JSON.parse(String(init?.body))
      if (String(url).endsWith('/count_tokens')) return Response.json({ input_tokens: 1000 })
      requests.push(body)
      generations++
      return Response.json({
        id: `claude-${generations}`,
        role: 'assistant',
        stop_reason: generations === 1 ? 'tool_use' : 'end_turn',
        content:
          generations === 1
            ? [
                {
                  type: 'thinking',
                  thinking: 'private reasoning fixture',
                  signature: 'signed-opaque',
                },
                { type: 'tool_use', id: 'claude-read', name: 'qb_get_research', input: {} },
              ]
            : [{ type: 'text', text: '已承接真实工具结果。' }],
      })
    }),
    run: <T>(_scope: unknown, work: () => T) => work(),
  }
  const service = new ResearchService(store, new PiModels(store, { network }))
  cleanup.push(() => service.shutdown())
  const run = await send(service, store, root, '读取实际分支')
  expect(run.session!.requests).toHaveLength(2)
  expect(JSON.stringify(requests[1])).toContain('signed-opaque')
  expect(JSON.stringify(requests[1])).toContain('tool_result')
  expect(
    (await store.sessions.load(run.session!.sessionId))!.messages.map((message) => message.role),
  ).toEqual(['user', 'assistant', 'tool', 'assistant'])
  supported = null
  // A new deployment identity cannot inherit the old capability proof.
  store.saveSettings({ ...store.settings(), anthropicWorkspaceId: 'another-scope' })
  const next = await service.command({ type: 'send-message', nodeId: root, message: '未知能力' })
  await vi.waitFor(() => expect(store.run(next.id!).status).toBe('failed'))
  expect(store.run(next.id!).error).toContain('CAPABILITY_UNKNOWN')
  expect(generations).toBe(2)
})

it('明确不支持原生的 Anthropic 部署走 OM，真实 SDK 协议接线仍复用同一鉴权', async () => {
  const { store, root } = setup()
  store.saveSettings({
    ...store.settings(),
    modelProvider: 'custom',
    baseUrl: 'https://portable.fixture.invalid',
    model: 'portable-fixture',
    modelContextWindow: 128000,
    apiProtocol: 'anthropic-messages',
    sessionStrategy: 'auto',
    apiKey: 'fixture-key',
  })
  const network = {
    fetch: vi.fn<typeof fetch>(async (url, init) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('x-api-key')).toBe('fixture-key')
      if (String(url).includes('/models/'))
        return Response.json({
          id: 'portable-fixture',
          capabilities: { compaction: { supported: false } },
        })
      return apiStream('anthropic-messages', '明确不支持原生时的完整回复。')
    }),
    run: <T>(_scope: unknown, work: () => T) => work(),
  }
  const service = new ResearchService(store, new PiModels(store, { network }))
  cleanup.push(() => service.shutdown())
  const run = await send(service, store, root, '走已核实的通用策略')
  expect(run.session!.requests[0].strategy).toBe('portable')
})

it('中断后的 pending 工具与导入恢复只补记账本真实结果，不再次执行副作用', async () => {
  const { store, service, faux, root, directory } = setup()
  faux.setResponses([fauxAssistantMessage('初次回复')])
  const run = await send(service, store, root, '建立会话')
  const session = await SessionWeave.open({
    sessionId: run.session!.sessionId,
    store: store.sessions,
  })
  const target = store.snapshot().nodes.find((node) => node.parentId === root)!
  const call = {
    id: 'interrupted-remove',
    name: 'qb_remove_branch',
    arguments: { node_id: target.id, expected_title: target.title, request_id: 'remove-receipt' },
  }
  await session.append([
    { id: 'interrupted-assistant', role: 'assistant', text: '', toolCalls: [call] },
  ])
  store.transaction(() => {
    const receipt = store.removeBranch(target.id, 'remove-receipt')
    store.sessions.saveResult(session.sessionId, call.id, {
      value: { removed: true, removal_id: receipt.removalId },
      summary: '此前真实移除结果',
    })
  })
  const remove = vi.spyOn(store, 'removeBranch')
  const recovered = new ResearchStore(join(directory, 'pending-import'), { seed: false })
  cleanup.push(() => recovered.close())
  recovered.importWorkspace(store.exportWorkspace('welcome-research'))
  recovered.saveSettings({ ...store.settings(), apiKey: 'fixture-secret' })
  const recovery = new ResearchService(
    recovered,
    new PiModels(recovered, { providers: [faux.provider] }),
  )
  cleanup.push(() => recovery.shutdown())
  const repeated = vi.spyOn(recovered, 'removeBranch')
  faux.setResponses([fauxAssistantMessage('从导入收据恢复')])
  const imported = await send(recovery, recovered, root, '核对导入收据')
  const importedState = (await recovered.sessions.load(imported.session!.sessionId))!
  expect(
    importedState.messages.find((message) => message.role === 'tool' && message.callId === call.id),
  ).toMatchObject({ isError: false })
  expect(repeated).not.toHaveBeenCalled()
  faux.setResponses([fauxAssistantMessage('已承接此前真实操作结果')])
  await send(service, store, root, '继续，先核对')
  expect(remove).not.toHaveBeenCalled()
  expect((await session.inspect()).pendingCallIds).toEqual([])
  const state = (await store.sessions.load(session.sessionId))!
  expect(
    state.messages.filter((message) => message.role === 'tool' && message.callId === call.id),
  ).toHaveLength(1)
  expect(store.node(target.id).removalId).toBe('remove-receipt')
})

it('整理报告与普通对话共用节点会话，截断回复仅保存到 QB 原文', async () => {
  const { store, service, faux, root } = setup()
  faux.setResponses([fauxAssistantMessage('明确的讨论结果')])
  const chat = await send(service, store, root, '先讨论')
  const output = {
    title: '阶段报告',
    summary: '基于此前讨论',
    findings: ['阶段认识'],
    openQuestions: [],
    followups: [],
    report: '# 阶段报告\n\n这是依据此前本节点讨论整理的完整阶段报告。',
  }
  faux.setResponses([fauxAssistantMessage(JSON.stringify(output))])
  const report = await service.command({
    type: 'start-research',
    nodeId: root,
    instruction: '整理为报告',
  })
  await vi.waitFor(() =>
    expect(store.run(report.id!).status, store.run(report.id!).error).toBe('completed'),
  )
  expect(store.run(report.id!).session!.sessionId).toBe(chat.session!.sessionId)
  const before = (await store.sessions.load(chat.session!.sessionId))!
  faux.setResponses([fauxAssistantMessage('这是一段截断草稿', { stopReason: 'length' })])
  const truncated = await service.command({
    type: 'send-message',
    nodeId: root,
    message: '继续说明',
  })
  await vi.waitFor(() => expect(store.run(truncated.id!).status).toBe('failed'))
  expect(store.run(truncated.id!).output).toContain('截断草稿')
  const after = (await store.sessions.load(before.sessionId))!
  expect(after.messages).toHaveLength(before.messages.length + 1)
  expect(after.messages.at(-1)!.role).toBe('user')
  expect(after.workingMemoryCheckpoints).toEqual(before.workingMemoryCheckpoints)
})

it('SQLite 原子修订与固定前缀候选采用，完整包在重开后仍可恢复', async () => {
  const { store, root } = setup()
  const owner = store.sessions.owner('welcome-research', root, 'store-contract-fixture')
  const engine = {
    identity: { engine: 'fixture@1', codec: 'fixture-json@1', policy: 'fixture@1' },
    async derive(input: { sessionId: string; sourceRevision: number; messages: { id: string }[] }) {
      const through = input.messages.at(-1)!.id
      return {
        complete: true as const,
        sourceRevision: input.sourceRevision,
        sourceThroughId: through,
        activeThroughId: through,
        identity: this.identity,
        engineState: { completeFixture: true },
        projection: '固定前缀的测试记忆',
        sources: [{ sessionId: input.sessionId, startId: input.messages[0].id, endId: through }],
      }
    },
  }
  const session = await SessionWeave.open({
    sessionId: owner.sessionId,
    store: store.sessions,
    workingMemory: engine,
  })
  await session.append([
    { id: 'u1', role: 'user', text: '第一项' },
    { id: 'a1', role: 'assistant', text: '第一项的回答' },
  ])
  const ticket = await session.precomputeWorkingMemory({ throughId: 'a1' })
  await session.append([{ id: 'u2', role: 'user', text: '候选生成后追加的新输入' }])
  const prepared = await session.prepare({
    strategy: 'portable',
    workingMemoryTicket: ticket,
    model: { id: 'store-fixture', contextWindow: 8000, countTokens: () => 100 },
    outputReserveTokens: 1000,
  })
  const saved = (await store.sessions.load(owner.sessionId))!
  expect(saved.version).toBe(3)
  expect(saved.workingMemoryCheckpoints!.at(-1)!.version).toBe(2)
  expect(saved.appendLog).toHaveLength(2)
  expect(
    (await SessionWeave.open({ sessionId: owner.sessionId, store: store.sessions })).sessionId,
  ).toBe(owner.sessionId)
  await expect(
    session.append([{ id: 'a2', role: 'assistant', text: '错误修订' }], {
      expectedRevision: prepared.revision - 1,
    }),
  ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
  expect(await store.sessions.load(owner.sessionId)).toEqual(saved)
})
