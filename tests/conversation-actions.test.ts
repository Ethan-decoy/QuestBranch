import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai'
import { ResearchStore } from '../src/desktop/store'
import { ResearchService } from '../src/desktop/service'
import { PiModels } from '../src/desktop/pi-models'
import { researchTools } from '../src/desktop/research-tools'
import { buildContext } from '../src/research/context'

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close()
  vi.restoreAllMocks()
})
function setup(contextWindow = 128000) {
  const directory = mkdtempSync(join(tmpdir(), 'qb-conversation-actions-'))
  const store = new ResearchStore(directory)
  cleanup.push(() => {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const root = store.snapshot().workspaces[0].rootId
  const report = store.snapshot().reports.find((report) => report.nodeId === root)!
  const target = store.createNode(root, '1', report.id)
  const first = store.snapshot().nodes.find((node) => node.parentId === root && node.id !== target)!
  const faux = fauxProvider({
    provider: 'fixture-actions',
    models: [{ id: 'fixture-model', contextWindow, maxTokens: 8192 }],
    tokensPerSecond: Infinity,
    tokenSize: { min: 32, max: 32 },
  })
  store.saveSettings({
    ...store.settings(),
    provider: 'compatible',
    modelProvider: faux.provider.id,
    model: 'fixture-model',
    baseUrl: '',
    apiKey: 'fixture-key',
    sessionStrategy: 'portable',
  })
  const runtime = new PiModels(store, { providers: [faux.provider] })
  const service = new ResearchService(store, runtime)
  cleanup.push(() => service.shutdown())
  return { store, service, faux, target, first, root }
}
const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' })

const savedResearch = {
  request_id: 'save-visual-directions',
  title: '视觉系统的阶段报告',
  summary: '明确视觉系统后续研究的四个方向。',
  findings: ['当前讨论形成了可独立研究的方向。'],
  openQuestions: ['各方向的方案仍待研究。'],
  report:
    '# 视觉系统的阶段报告\n\n根据当前节点的讨论，保留已有认识与尚未验证的问题，继续研究具体方案。',
  followups: ['Logo', '色板', '排版', '图标'].map((title) => ({
    title,
    question: `如何设计${title}？`,
  })),
}

it('无自身报告的节点可在聊天中调用工具原子保存报告和四个子分支，归属当前节点', async () => {
  const { store, service, faux, target } = setup()
  const before = store.snapshot()
  faux.setResponses([
    call('qb_get_research', {}),
    call('qb_save_research', savedResearch),
    fauxAssistantMessage('阶段报告与四个子分支已保存。'),
  ])
  const started = await service.command({
    type: 'send-message',
    nodeId: target,
    message: '构建这些子分支',
  })
  await vi.waitFor(() => expect(store.run(started.id!).status).not.toBe('running'), {
    timeout: 15000,
  })
  const run = store.run(started.id!)
  expect(run.status, run.error).toBe('completed')
  const snapshot = store.snapshot()
  const report = snapshot.reports.find((report) => report.nodeId === target)
  expect(report?.markdown).toBe(savedResearch.report)
  expect(report?.runId).toBe(run.id)
  expect(snapshot.reports.filter((report) => report.nodeId !== target)).toEqual(before.reports)
  const children = snapshot.nodes.filter((node) => node.parentId === target)
  expect(children).toHaveLength(4)
  expect(children.every((child) => child.originReportId === report!.id)).toBe(true)
  expect(run.mode).toBe('chat')
  expect(run.reportId).toBeUndefined()
  expect(run.toolCalls?.[1].result).toMatchObject({
    report_id: report!.id,
    node_ids: children.map((n) => n.id),
  })
  expect(run.activities?.[1].status).toBe('completed')
  const restoredDirectory = mkdtempSync(join(tmpdir(), 'qb-saved-report-restore-'))
  const restored = new ResearchStore(restoredDirectory, { seed: false })
  cleanup.push(() => {
    restored.close()
    rmSync(restoredDirectory, { recursive: true, force: true })
  })
  restored.importWorkspace(store.exportWorkspace(run.workspaceId))
  expect(restored.report(report!.id)).toEqual(report)
  const retry = { ...run, id: 'retry-saved-research', status: 'running' as const, output: '' }
  restored.saveRun(retry)
  const result = researchTools(restored, retry.id, new AbortController().signal)
    .find((tool) => tool.name === 'qb_save_research')!
    .execute(savedResearch)
  expect(result.value).toMatchObject({ report_id: report!.id, node_ids: children.map((n) => n.id) })
  expect(restored.snapshot().reports).toHaveLength(snapshot.reports.length)
})

it('保存研究工具可仅保存报告；同次请求幂等、冲突拒绝，创建失败不留下半份报告', () => {
  const { store, target, root } = setup()
  const run = {
    id: 'save-report-fixture',
    workspaceId: store.node(target).workspaceId,
    nodeId: target,
    mode: 'chat' as const,
    instruction: '保存报告',
    status: 'running' as const,
    phase: 'fixture',
    output: '',
    error: '',
    model: 'fixture',
    createdAt: new Date().toISOString(),
    context: buildContext(store.snapshot(), target, '保存报告', [], 'chat'),
  }
  // Use a real node context, without borrowing the parent's report identity.
  store.saveRun(run)
  const tool = researchTools(store, run.id, new AbortController().signal).find(
    (tool) => tool.name === 'qb_save_research',
  )
  expect(tool).toBeDefined()
  const reportOnly = { ...savedResearch, followups: [] }
  const first = tool!.execute(reportOnly)
  expect(tool!.execute(reportOnly)).toEqual(first)
  expect(first.value.node_ids).toEqual([])
  expect(() => tool!.execute({ ...reportOnly, summary: '不同内容' })).toThrow('已用于其他内容')
  const count = store.snapshot().reports.length
  const nodes = store.snapshot().nodes.length
  vi.spyOn(store, 'insertNode').mockImplementationOnce(() => {
    throw new Error('fixture write failed')
  })
  expect(() => tool!.execute({ ...savedResearch, request_id: 'failed-save' })).toThrow(
    'fixture write failed',
  )
  expect(store.snapshot().reports).toHaveLength(count)
  expect(store.snapshot().nodes).toHaveLength(nodes)
  expect(store.snapshot().reports.filter((report) => report.nodeId === root)).toHaveLength(1)
})

it('保存工具提交后停止回复仍保留完整报告、分支与真实结果账本', async () => {
  const { store, service, faux, target } = setup()
  let runId = ''
  const save = store.saveResearch.bind(store)
  vi.spyOn(store, 'saveResearch').mockImplementation((...args) => {
    const result = save(...args)
    queueMicrotask(() => void service.command({ type: 'cancel-research', runId }))
    return result
  })
  faux.setResponses([call('qb_save_research', savedResearch), fauxAssistantMessage('已保存。')])
  const started = await service.command({
    type: 'send-message',
    nodeId: target,
    message: '保存成果和方向',
  })
  runId = started.id!
  await vi.waitFor(() => expect(store.run(runId).status).toBe('cancelled'), { timeout: 15000 })
  await vi.waitFor(() => expect(store.run(runId).activities?.[0]?.status).toBe('completed'))
  const report = store.snapshot().reports.find((report) => report.runId === runId)!
  expect(report.markdown).toBe(savedResearch.report)
  expect(store.snapshot().nodes.filter((node) => node.originReportId === report.id)).toHaveLength(4)
  const state = await store.sessions.load(store.run(runId).session!.sessionId)
  const result = state!.messages.find((message) => message.role === 'tool')!
  expect(store.sessions.result(state!.sessionId, result.callId!)!.value).toMatchObject({
    report_id: report.id,
  })
})

it('小窗口模型以持续会话逐轮准备工具输入，记录实际请求', async () => {
  const { store, service, faux, root } = setup(8192)
  faux.setResponses([call('qb_get_research', {}), fauxAssistantMessage('已读取当前分支。')])
  const run = await service.command({
    type: 'send-message',
    nodeId: root,
    message: '现在有哪些分支？',
  })
  await vi.waitFor(
    () => expect(store.run(run.id!).status, store.run(run.id!).error).toBe('completed'),
    { timeout: 10000 },
  )
  expect(store.run(run.id!).session?.requests).toHaveLength(2)
  expect(store.run(run.id!).activities?.[0].status).toBe('completed')
  expect(store.run(run.id!).output).toBe('已读取当前分支。')
})

it('删除标题为 1 的分支会执行真实工具；不删除第一个分支、不生成报告，支持撤销及导出恢复', async () => {
  const { store, service, faux, target, first, root } = setup()
  const before = store.snapshot()
  faux.setResponses([
    call('qb_get_research', {}),
    call('qb_remove_branch', { node_id: target, expected_title: '1', request_id: 'remove-one' }),
    fauxAssistantMessage('已移除标题为“1”的分支，可以撤销。'),
  ])
  const run = await service.command({ type: 'send-message', nodeId: root, message: '删除分支的1' })
  await vi.waitFor(() => expect(store.run(run.id!).status).toBe('completed'))
  const finished = store.run(run.id!)
  expect(store.node(target)).toMatchObject({ title: '1', removalId: 'remove-one' })
  expect(store.node(first.id).removedAt).toBeUndefined()
  expect(store.snapshot().reports).toEqual(before.reports)
  expect(finished.activities?.map((activity) => [activity.title, activity.status])).toEqual([
    ['读取研究与分支', 'completed'],
    ['移除研究分支', 'completed'],
  ])
  expect(finished.activities?.at(-1)?.undo).toEqual({ nodeId: target, removalId: 'remove-one' })
  expect(finished.output).not.toContain('expected_title')
  expect(finished.toolCalls?.at(-1)?.result).toMatchObject({ removed: true, node_id: target })
  const exported = store.exportWorkspace(before.workspaces[0].id)
  const directory = mkdtempSync(join(tmpdir(), 'qb-conversation-actions-restore-'))
  const restored = new ResearchStore(directory, { seed: false })
  cleanup.push(() => {
    restored.close()
    rmSync(directory, { recursive: true, force: true })
  })
  restored.importWorkspace(exported)
  expect(restored.node(target).removalId).toBe('remove-one')
  expect(restored.run(run.id!).activities).toEqual(finished.activities)
  await service.command({ type: 'restore-branch', nodeId: target, removalId: 'remove-one' })
  expect(store.node(target).removedAt).toBeUndefined()
  expect(store.node(target).originReportId).toBe(
    before.nodes.find((node) => node.id === target)!.originReportId,
  )
  expect(() => store.removeBranch(target, 'remove-one')).toThrow('已撤销')
})

it('有后代的分支原子移除、恢复，不误恢复此前已移除的后代，重复请求不重复修订', () => {
  const { store, first } = setup()
  const report = store.snapshot().reports.find((report) => report.nodeId === first.id)!
  const child = store.createNode(first.id, '已有报告的后代', report.id)
  store.removeBranch(child, 'remove-child')
  const original = store.snapshot().reports
  const removed = store.removeBranch(first.id, 'remove-parent')
  expect(store.removeBranch(first.id, 'remove-parent')).toEqual(removed)
  store.restoreBranch(first.id, 'remove-parent')
  expect(store.node(first.id).removedAt).toBeUndefined()
  expect(store.node(child).removalId).toBe('remove-child')
  expect(store.snapshot().reports).toEqual(original)
})

it('标题、范围、根问题和运行中的子树均经过工具/存储约束，失败不能伪造成功', async () => {
  const { store, service, faux, target, root } = setup()
  faux.setResponses([
    call('qb_remove_branch', {
      node_id: target,
      expected_title: '错误标题',
      request_id: 'wrong-title',
    }),
    fauxAssistantMessage('没有移除：目标标题不匹配。'),
  ])
  const run = await service.command({ type: 'send-message', nodeId: root, message: '删除1' })
  await vi.waitFor(() => expect(store.run(run.id!).status).toBe('completed'))
  expect(store.node(target).removedAt).toBeUndefined()
  expect(store.run(run.id!).activities?.[0]).toMatchObject({ status: 'failed' })
  expect(() => store.removeBranch(root, 'root')).toThrow('根问题')
  const active = {
    ...store.run(run.id!),
    id: 'live-child',
    nodeId: target,
    status: 'running' as const,
  }
  store.saveRun(active)
  expect(() => store.removeBranch(target, 'busy')).toThrow('正在生成')
  const tools = researchTools(store, active.id, new AbortController().signal)
  expect(() =>
    tools
      .find((tool) => tool.name === 'qb_remove_branch')!
      .execute({ node_id: root, expected_title: store.node(root).title, request_id: 'foreign' }),
  ).toThrow('直接子分支')
})

it('截断的工具请求不修改图谱；停止后仍保留已经完成的移除与撤销入口', async () => {
  const { store, service, faux, target, root } = setup()
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('qb_remove_branch', {
        node_id: target,
        expected_title: '1',
        request_id: 'truncated',
      }),
      { stopReason: 'length' },
    ),
  ])
  const truncated = await service.command({ type: 'send-message', nodeId: root, message: '删除1' })
  await vi.waitFor(() => expect(store.run(truncated.id!).status).toBe('failed'))
  expect(store.node(target).removedAt).toBeUndefined()
  let runId = ''
  const remove = store.removeBranch.bind(store)
  vi.spyOn(store, 'removeBranch').mockImplementation((nodeId, removalId) => {
    const result = remove(nodeId, removalId)
    queueMicrotask(() => void service.command({ type: 'cancel-research', runId }))
    return result
  })
  faux.setResponses([
    call('qb_remove_branch', { node_id: target, expected_title: '1', request_id: 'then-stop' }),
    fauxAssistantMessage('已移除。'),
  ])
  const started = await service.command({ type: 'send-message', nodeId: root, message: '删除1' })
  runId = started.id!
  await vi.waitFor(() => expect(store.run(runId).status).toBe('cancelled'))
  await vi.waitFor(() => expect(store.run(runId).activities?.[0]?.status).toBe('completed'))
  expect(store.node(target).removalId).toBe('then-stop')
  expect(store.run(runId).activities?.[0]?.undo).toEqual({ nodeId: target, removalId: 'then-stop' })
})
