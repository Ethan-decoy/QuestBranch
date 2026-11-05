// Protocol fixture: real stdio/SDK transport, no network, credentials or model use.
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
} from '@agentclientprotocol/sdk'
import { Readable, Writable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const scenario = process.argv[2] ?? 'normal'
let mcp, mcpDescriptor
const isMcp = scenario.startsWith('mcp-')
const toolValue = (response) => {
  if (response.isError) throw new Error(JSON.stringify(response.content))
  return (
    response.structuredContent ??
    JSON.parse(response.content.find((part) => part.type === 'text').text)
  )
}
const loginFile = () => join(process.cwd(), 'fixture-authenticated')
let sessionId,
  value = 'fixture-model',
  effort = 'low',
  cancelled = false
const option = () => [
  {
    id: 'model',
    name: '模型',
    category: 'model',
    type: 'select',
    currentValue: value,
    options: [
      { value: 'fixture-model', name: 'Fixture' },
      { value: 'fixture-deep', name: 'Fixture Deep' },
    ],
  },
  ...(scenario === 'picker'
    ? [
        {
          id: 'reasoning_effort',
          name: '思考强度',
          category: 'thought_level',
          type: 'select',
          currentValue: effort,
          options:
            value === 'fixture-deep'
              ? [
                  { value: 'high', name: '高' },
                  { value: 'xhigh', name: '很高' },
                ]
              : [
                  { value: 'low', name: '低' },
                  { value: 'medium', name: '中' },
                ],
        },
      ]
    : []),
]
const app = agent({ name: 'fixture' })
  .onRequest(methods.agent.initialize, async () => {
    if (scenario === 'startup') await new Promise(() => {})
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: { name: 'Fixture ACP', version: '1' },
      agentCapabilities: { mcpCapabilities: { http: isMcp && scenario !== 'mcp-stdio' } },
      authMethods: [{ id: 'device-code', name: '登录 Fixture' }],
    }
  })
  .onRequest(methods.agent.authenticate, async ({ client, requestId }) => {
    const response = await client.request(methods.client.elicitation.create, {
      mode: 'url',
      requestId,
      elicitationId: 'login',
      message: '请使用代码 QB-1234 登录',
      url: 'https://example.com/activate',
    })
    if (response.action !== 'accept') throw new Error('登录已取消')
    writeFileSync(loginFile(), 'fixture')
    return {}
  })
  .onRequest(methods.agent.session.new, async ({ client, params }) => {
    if (scenario === 'auth' && !existsSync(loginFile())) throw RequestError.authRequired()
    sessionId = randomUUID()
    if (isMcp) {
      mcpDescriptor = params.mcpServers[0]
      if (!mcpDescriptor) throw new Error('No QB MCP server was injected')
      mcp = new Client({ name: 'qb-fixture-agent', version: '1' })
      const descriptor = mcpDescriptor
      await mcp.connect(
        descriptor.type === 'http'
          ? new StreamableHTTPClientTransport(new URL(descriptor.url), {
              requestInit: {
                headers: Object.fromEntries(
                  descriptor.headers.map(({ name, value }) => [name, value]),
                ),
              },
            })
          : new StdioClientTransport({
              command: descriptor.command,
              args: descriptor.args,
              env: {
                ...process.env,
                ...Object.fromEntries(descriptor.env.map(({ name, value }) => [name, value])),
              },
              stderr: 'pipe',
            }),
      )
    }
    void client.notify(methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: 'skills', description: '列出原生技能' }],
      },
    })
    return { sessionId, configOptions: option() }
  })
  .onRequest(methods.agent.session.setConfigOption, ({ params }) => {
    if (scenario === 'picker' && params.configId === 'reasoning_effort') effort = params.value
    else {
      value = params.value
      if (scenario === 'picker') effort = value === 'fixture-deep' ? 'high' : 'low'
    }
    return { configOptions: option() }
  })
  .onNotification(methods.agent.session.cancel, () => {
    cancelled = true
  })
  .onRequest(methods.agent.session.prompt, async ({ client, params }) => {
    if (scenario === 'exit') process.exit(7)
    const notify = (update) =>
      client.notify(methods.client.session.update, { sessionId: params.sessionId, update })
    if (scenario === 'mcp-save') {
      await notify({
        sessionUpdate: 'tool_call',
        toolCallId: 'qb-save',
        title: '保存报告与研究方向',
        kind: 'edit',
        status: 'in_progress',
      })
      const input = {
        request_id: 'acp-save-research',
        title: 'ACP 阶段报告',
        summary: '当前研究的阶段认识。',
        findings: ['来自当前讨论的认识'],
        openQuestions: ['方案有待验证'],
        report:
          '# ACP 研究报告\n\n通过原生智能体工具保存当前节点的阶段认识，参见[官方资料](https://example.com/research)。主张仍待核验。',
        followups: [{ title: 'ACP 后续方向', question: '如何继续验证这个研究方向？' }],
      }
      const saved = toolValue(await mcp.callTool({ name: 'qb_save_research', arguments: input }))
      const retried = toolValue(await mcp.callTool({ name: 'qb_save_research', arguments: input }))
      if (JSON.stringify(saved) !== JSON.stringify(retried)) throw new Error('Save retry differs')
      await notify({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'qb-save',
        status: 'completed',
        content: [
          { type: 'content', content: { type: 'text', text: '已保存阶段报告和一个方向。' } },
        ],
      })
      await notify({
        sessionUpdate: 'agent_message_chunk',
        messageId: 'saved',
        content: { type: 'text', text: '阶段报告和后续方向已保存。' },
      })
      return { stopReason: 'end_turn' }
    }
    if (isMcp) {
      const tools = await mcp.listTools()
      const current = toolValue(await mcp.callTool({ name: 'qb_get_research', arguments: {} }))
      const source = toolValue(
        await mcp.callTool({
          name: 'qb_get_report',
          arguments: { report_id: current.selected_report_id },
        }),
      )
      if (source.report.nodeId !== current.current_node.id)
        throw new Error('Wrong MCP source owner')
      const input = {
        source_report_id: source.report.id,
        request_id: 'fixture-branches-v1',
        branches: [
          { title: 'MCP 后续方向 B', question: 'MCP 后续方向 B：如何保证研究连续性？' },
          { title: 'MCP 后续方向 C', question: 'MCP 后续方向 C：如何解释来源版本？' },
        ],
      }
      await notify({
        sessionUpdate: 'tool_call',
        toolCallId: 'qb-create',
        title: '创建研究方向',
        kind: 'edit',
        status: 'in_progress',
      })
      const first = toolValue(await mcp.callTool({ name: 'qb_create_branches', arguments: input }))
      const retry = toolValue(await mcp.callTool({ name: 'qb_create_branches', arguments: input }))
      if (JSON.stringify(first.node_ids) !== JSON.stringify(retry.node_ids))
        throw new Error('MCP retry created different nodes')
      writeFileSync(
        join(process.cwd(), 'fixture-mcp.json'),
        JSON.stringify({
          transport: mcpDescriptor.type ?? 'stdio',
          toolNames: tools.tools.map((tool) => tool.name),
          selectedReportId: current.selected_report_id,
          nodeIds: first.node_ids,
          parentId: first.parent_id,
          retried: true,
        }),
      )
      await notify({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'qb-create',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: { type: 'text', text: `已创建两个待研究方向：${first.node_ids.join('、')}` },
          },
        ],
      })
      if (scenario === 'mcp-wait')
        await client.request(methods.client.session.requestPermission, {
          sessionId,
          toolCall: { toolCallId: 'qb-create', title: '继续本次研究？' },
          options: [{ optionId: 'once', name: '继续', kind: 'allow_once' }],
        })
    }
    await notify({
      sessionUpdate: 'tool_call',
      toolCallId: 'search-1',
      title: '检索最新资料',
      kind: 'search',
      status: 'in_progress',
      rawInput: { private: 'RAW_DEBUG_ONLY' },
    })
    if (scenario === 'permission' || scenario === 'cancel') {
      const permission = await client.request(methods.client.session.requestPermission, {
        sessionId,
        toolCall: { toolCallId: 'search-1', title: '允许这次检索？' },
        options: [
          { optionId: 'once', name: '允许一次', kind: 'allow_once' },
          { optionId: 'reject', name: '拒绝', kind: 'reject_once' },
        ],
      })
      await notify({
        sessionUpdate: 'agent_message_chunk',
        messageId: 'progress',
        content: { type: 'text', text: '正在查阅资料。' },
      })
      if (permission.outcome.outcome === 'cancelled') return { stopReason: 'cancelled' }
    }
    await notify({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'search-1',
      status: 'completed',
      content: [
        {
          type: 'content',
          content: { type: 'text', text: '已找到官方文档 https://example.com/research' },
        },
      ],
      rawOutput: { private: 'RAW_DEBUG_ONLY' },
    })
    const text = params.prompt
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
    const response =
      scenario === 'markdown'
        ? '# 原生 Markdown 报告\n\n这份完整报告由智能体返回，通过原生工具查阅资料，主张仍需进一步核查。'
        : scenario === 'invalid'
          ? '{"title":"不完整"}'
          : text === '/skills'
            ? '原生技能：research、compare。'
            : text.includes('输出一个 JSON 对象')
              ? JSON.stringify({
                  title: 'ACP 阶段报告',
                  summary: '工具检索完成，资料仍需判断。',
                  findings: ['外部主张'],
                  openQuestions: ['待验证问题'],
                  report:
                    '# ACP 研究报告\n\n通过原生工具继续研究，参见[官方资料](https://example.com/research)。这是一份协议测试报告。',
                  followups: [],
                })
              : `已通过原生工具继续研究（${value}）。参见[资料](https://example.com/research)。`
    await notify({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'answer',
      content: { type: 'text', text: response.slice(0, 15) },
    })
    await new Promise((resolve) => setTimeout(resolve, 60))
    await notify({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'answer',
      content: { type: 'text', text: response.slice(15) },
    })
    return { stopReason: cancelled ? 'cancelled' : 'end_turn' }
  })
app.connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
process.stdin.on('end', () => {
  void Promise.resolve(mcp?.close()).finally(() => process.exit(0))
})
