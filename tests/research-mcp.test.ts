import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { openResearchMcp } from '../src/desktop/research-mcp'
import { ResearchStore } from '../src/desktop/store'
import { buildContext } from '../src/research/context'

const resources: {
  store: ResearchStore
  directory: string
  client: Client
  scope: Awaited<ReturnType<typeof openResearchMcp>>
  controller: AbortController
}[] = []
async function setup(nodeId = 'visual') {
  const directory = mkdtempSync(join(tmpdir(), 'qb-mcp-')),
    store = new ResearchStore(directory)
  const runId = randomUUID(),
    controller = new AbortController()
  store.saveView('welcome-research', {
    ...store.snapshot().views['welcome-research'],
    readers: { visual: { tab: 'report', reportId: 'report-visual' } },
  })
  store.insertReport({
    ...store.report('report-visual'),
    id: 'report-visual-new',
    title: 'A的新版本',
  })
  store.saveRun({
    id: runId,
    nodeId,
    mode: 'chat',
    workspaceId: 'welcome-research',
    instruction: '根据这份报告创建',
    status: 'running',
    phase: 'fixture',
    output: '',
    error: '',
    model: 'fixture',
    createdAt: new Date().toISOString(),
    context: buildContext(store.snapshot(), nodeId, ''),
  })
  const scope = await openResearchMcp(store, runId, controller.signal)
  const descriptor = scope.servers({ http: true })[0]
  if (!('url' in descriptor)) throw new Error('Expected HTTP capability')
  const client = new Client({ name: 'qb-test', version: '1' })
  resources.push({ directory, store, scope, client, controller })
  const headers = Object.fromEntries(descriptor.headers.map(({ name, value }) => [name, value]))
  await client.connect(
    new StreamableHTTPClientTransport(new URL(descriptor.url), { requestInit: { headers } }),
  )
  return { directory, store, scope, client, controller, runId, url: descriptor.url, headers }
}
function value(response: Awaited<ReturnType<Client['callTool']>>) {
  expect(response.isError).not.toBe(true)
  return response.structuredContent as Record<string, unknown>
}
afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.client.close()
    await resource.scope.close()
    resource.store.close()
    if (
      !resolve(resource.directory).startsWith(resolve(tmpdir()) + sep) ||
      !resource.directory.includes('qb-mcp-')
    )
      throw new Error('Unexpected test directory')
    rmSync(resource.directory, { recursive: true, force: true })
  }
})

describe('真实 MCP SDK HTTP 工具服务', () => {
  it('AI 经 MCP 原子保存当前节点的报告和方向，重试、分页读取和范围校验正常', async () => {
    const { store, client, runId } = await setup()
    const input = {
      request_id: 'mcp-save-research',
      title: '阶段成果',
      summary: '保存当前研究成果。',
      findings: ['阶段认识'],
      openQuestions: ['仍待验证'],
      report: '# 阶段成果\n\n根据当前讨论整理阶段认识，新的主张仍待验证，继续研究后续方向。',
      followups: [{ title: '独立后续问题', question: '如何验证这个阶段的认识？' }],
    }
    const first = value(await client.callTool({ name: 'qb_save_research', arguments: input }))
    expect(value(await client.callTool({ name: 'qb_save_research', arguments: input }))).toEqual(
      first,
    )
    expect(first.parent_id).toBe('visual')
    expect(store.report(String(first.report_id))).toMatchObject({
      nodeId: 'visual',
      runId,
      markdown: input.report,
    })
    expect(store.node((first.node_ids as string[])[0]).originReportId).toBe(first.report_id)
    expect(
      value(
        await client.callTool({ name: 'qb_get_report', arguments: { report_id: first.report_id } }),
      ),
    ).toHaveProperty('report.markdown', input.report)
    expect(
      (
        await client.callTool({
          name: 'qb_save_research',
          arguments: { ...input, summary: '冲突的重试' },
        })
      ).isError,
    ).toBe(true)
    expect(store.run(runId).status).toBe('running')
  })
  it('stdio 桥接可由真实 SDK 子进程读取同一作用域，关闭后正常退出', async () => {
    const { scope } = await setup()
    const descriptor = scope.servers()[0]
    if (!('command' in descriptor)) throw new Error('Expected stdio fallback')
    const transport = new StdioClientTransport({
      command: descriptor.command,
      args: descriptor.args,
      env: Object.fromEntries(descriptor.env.map(({ name, value }) => [name, value])),
      stderr: 'pipe',
    })
    let diagnostic = ''
    transport.stderr?.on('data', (data) => {
      diagnostic += data
    })
    const client = new Client({ name: 'stdio-probe', version: '1' })
    try {
      await client.connect(transport)
      expect((await client.listTools()).tools).toHaveLength(6)
      expect(
        value(await client.callTool({ name: 'qb_get_research', arguments: {} })).selected_report_id,
      ).toBe('report-visual')
    } catch (error) {
      throw new Error(`stdio bridge: ${diagnostic}`, { cause: error })
    } finally {
      await client.close()
    }
  }, 15_000)
  it('发现工具、读取当前选择的历史报告、批量创建并增量刷新，切换UI不改变本轮范围', async () => {
    const { client, store } = await setup()
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      'qb_get_research',
      'qb_get_report',
      'qb_save_research',
      'qb_create_branches',
      'qb_remove_branch',
      'qb_restore_branch',
    ])
    const current = value(await client.callTool({ name: 'qb_get_research', arguments: {} }))
    expect(current.selected_report_id).toBe('report-visual')
    expect(current.reports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'report-visual', version: 1, can_derive: true }),
        expect.objectContaining({ id: 'report-visual-new', version: 2 }),
      ]),
    )
    store.saveView('welcome-research', { selectedId: 'context', collapsed: [], drafts: {} })
    const input = {
      source_report_id: 'report-visual',
      request_id: 'two-branches',
      branches: [{ question: 'B的问题' }, { question: 'C的问题' }],
    }
    const before = store.snapshot().version
    const first = value(await client.callTool({ name: 'qb_create_branches', arguments: input }))
    const retry = value(await client.callTool({ name: 'qb_create_branches', arguments: input }))
    expect(first.node_ids).toEqual(retry.node_ids)
    const update = store.snapshot(before)!
    const children = update.nodes.filter((node) => (first.node_ids as string[]).includes(node.id))
    expect(children).toHaveLength(2)
    expect(
      children.every(
        (node) => node.parentId === 'visual' && node.originReportId === 'report-visual',
      ),
    ).toBe(true)
    expect(
      update.runs.filter((run) => children.some((node) => node.id === run.nodeId)),
    ).toHaveLength(0)
    expect(
      (
        value(await client.callTool({ name: 'qb_get_research', arguments: {} })).current_node as {
          id: string
        }
      ).id,
    ).toBe('visual')
  })
  it('拒绝无凭据、外部Origin、错父报告、越空间、任意RPC和冲突重试；有效报告可在运行中加入', async () => {
    const { client, store, url, headers } = await setup()
    expect((await fetch(url, { method: 'POST' })).status).toBe(401)
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: { ...headers, Origin: 'https://unrelated.example' },
        })
      ).status,
    ).toBe(403)
    const before = store.snapshot().nodes.length
    for (const report of ['report-context', 'missing']) {
      const response = await client.callTool({
        name: 'qb_create_branches',
        arguments: {
          source_report_id: report,
          request_id: report,
          branches: [{ question: '不允许' }],
        },
      })
      expect(response.isError).toBe(true)
    }
    const foreign = store.createWorkspace('无关的私有空间'),
      otherRoot = store.snapshot().workspaces.find((workspace) => workspace.id === foreign)!.rootId
    store.transaction(() =>
      store.insertReport({
        ...store.report('report-root'),
        id: 'foreign-report',
        nodeId: otherRoot,
        workspaceId: foreign,
      }),
    )
    expect(
      (await client.callTool({ name: 'qb_get_report', arguments: { report_id: 'foreign-report' } }))
        .isError,
    ).toBe(true)
    expect(
      (
        await client.callTool({
          name: 'qb_create_branches',
          arguments: {
            source_report_id: 'foreign-report',
            request_id: 'foreign',
            branches: [{ question: '不允许' }],
          },
        })
      ).isError,
    ).toBe(true)
    expect(
      (await client.callTool({ name: 'execute_command', arguments: { command: 'anything' } }))
        .isError,
    ).toBe(true)
    expect(store.snapshot().nodes).toHaveLength(before + 1)
    store.transaction(() =>
      store.insertReport({ ...store.report('report-visual'), id: 'saved-during-run' }),
    )
    const input = {
      source_report_id: 'saved-during-run',
      request_id: 'new-report',
      branches: [{ question: '基于新保存报告' }],
    }
    value(await client.callTool({ name: 'qb_create_branches', arguments: input }))
    expect(
      (
        await client.callTool({
          name: 'qb_create_branches',
          arguments: { ...input, branches: [{ question: '冲突请求' }] },
        })
      ).isError,
    ).toBe(true)
  })
  it('没有自己的报告的待研究节点不能用父报告越级创建', async () => {
    const { client, store } = await setup('layout')
    const before = store.snapshot().nodes
    expect(
      (
        await client.callTool({
          name: 'qb_create_branches',
          arguments: {
            source_report_id: 'report-visual',
            request_id: 'no-saved-report',
            branches: [{ question: '不允许' }],
          },
        })
      ).isError,
    ).toBe(true)
    expect(store.snapshot().nodes).toEqual(before)
  })
  it('MCP 移除真实子分支并提供可撤销活动；重试不重复记录，恢复后不重放旧移除', async () => {
    const { client, store, runId } = await setup()
    const target = store.createNode('visual', '1', 'report-visual')
    const arguments_ = { node_id: target, expected_title: '1', request_id: 'mcp-remove-one' }
    const beforeReports = store.snapshot().reports
    const removed = value(
      await client.callTool({ name: 'qb_remove_branch', arguments: arguments_ }),
    )
    expect(removed).toMatchObject({ removed: true, node_id: target })
    value(await client.callTool({ name: 'qb_remove_branch', arguments: arguments_ }))
    expect(store.run(runId).activities).toHaveLength(1)
    expect(store.run(runId).activities?.[0].undo).toEqual({
      nodeId: target,
      removalId: 'mcp-remove-one',
    })
    const inventory = value(await client.callTool({ name: 'qb_get_research', arguments: {} }))
    expect(inventory.removed_children).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: target, title: '1' })]),
    )
    value(
      await client.callTool({
        name: 'qb_restore_branch',
        arguments: { node_id: target, removal_id: 'mcp-remove-one' },
      }),
    )
    expect(store.node(target).removedAt).toBeUndefined()
    expect(store.snapshot().reports).toEqual(beforeReports)
    expect(
      (await client.callTool({ name: 'qb_remove_branch', arguments: arguments_ })).isError,
    ).toBe(true)
  })
  it.each(['cancel', 'finish', 'close'] as const)('%s 后作用域立即失效，不再写入', async (mode) => {
    const { client, store, controller, scope, runId } = await setup()
    const before = store.snapshot().nodes.length
    if (mode === 'cancel') controller.abort()
    else if (mode === 'finish') store.saveRun({ ...store.run(runId), status: 'completed' })
    else await scope.close()
    const invoke = client.callTool({
      name: 'qb_create_branches',
      arguments: {
        source_report_id: 'report-visual',
        request_id: 'late-write',
        branches: [{ question: '迟到的调用' }],
      },
    })
    await expect(invoke).rejects.toThrow()
    expect(store.snapshot().nodes).toHaveLength(before)
  })
})
