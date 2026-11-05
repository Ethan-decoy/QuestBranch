import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ResearchStore, viewSchema } from './store'
import { buildContext, estimateTokens } from '../research/context'
import {
  ResearchOutputSchema,
  ReasoningEffortSchema,
  ApiProtocolSchema,
  SourceSchema,
  type AppCommand,
  type ResearchClient,
  type ResearchRun,
  type SettingsInput,
  type Snapshot,
} from '../research/types'
import { webSearch } from '../research/providers'
import { modelConnectionKey } from '../research/api-services'
import { PiModels } from './pi-models'
import { AcpAgents } from './acp-agent'
import { openResearchMcp } from './research-mcp'
import { AgentConfigSchema, type AgentRun } from '../research/agent'
import { branchReport } from '../research/branching'
import { defaultNetwork, type Network } from './network'
import { researchTools } from './research-tools'
import { type ModelProgress } from './model-tool-turn'

const id = z.string().min(1).max(200),
  question = z.string().trim().min(1, '请输入研究问题').max(6000),
  key = z.string().max(1000).optional()
const settingsSchema = z.object({
  sessionStrategy: z.enum(['auto', 'native', 'portable']).optional(),
  sessionInputBudget: z.number().int().min(4000).max(2000000).optional(),
  modelContextWindow: z.number().int().min(4000).max(2000000).optional(),
  backend: z.enum(['model', 'acp']).optional(),
  agent: AgentConfigSchema.optional(),
  provider: z.enum(['compatible', 'ollama', 'account']),
  modelProvider: z.string().min(1).max(200).optional(),
  baseUrl: z
    .string()
    .max(1000)
    .refine((value) => {
      if (!value) return true
      try {
        const url = new URL(value)
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        )
      } catch {
        return false
      }
    }, '服务地址应为不含密钥、查询参数或片段的 HTTP / HTTPS 地址'),
  model: z.string().max(200),
  apiProtocol: ApiProtocolSchema.optional(),
  maxOutputTokens: z.number().int().min(1).max(128000).optional(),
  anthropicWorkspaceId: z.string().trim().max(200).optional(),
  jsonMode: z.boolean(),
  contextBudget: z.number().int().min(4000).max(128000),
  apiKey: key,
  searchKey: key,
  clearApiKey: z.boolean().optional(),
  clearSearchKey: z.boolean().optional(),
  reasoningEffort: ReasoningEffortSchema.or(z.literal('')).optional(),
})
const commandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create-workspace'),
    question,
    name: z.string().trim().max(100).optional(),
    constraints: z.string().max(6000).optional(),
  }),
  z.object({
    type: z.literal('create-node'),
    parentId: id,
    sourceReportId: id,
    question,
    requestId: id.optional(),
    relatedIds: z.array(id).max(10).optional(),
    referenceReportIds: z.array(id).max(20).optional(),
  }),
  z.object({ type: z.literal('edit-node'), nodeId: id, question }),
  z.object({ type: z.literal('remove-branch'), nodeId: id, requestId: id }),
  z.object({ type: z.literal('restore-branch'), nodeId: id, removalId: id }),
  z.object({ type: z.literal('save-view'), workspaceId: id, view: viewSchema }),
  z.object({
    type: z.literal('save-settings'),
    settings: settingsSchema,
  }),
  z.object({
    type: z.literal('start-research'),
    nodeId: id,
    instruction: z.string().trim().max(12000),
    reportIds: z.array(id).max(20).optional(),
    selectedReportId: id.optional(),
  }),
  z.object({ type: z.literal('cancel-research'), runId: id }),
  z.object({
    type: z.literal('send-message'),
    nodeId: id,
    message: z.string().trim().min(1, '请输入对话内容').max(12000),
    selectedReportId: id.optional(),
  }),
  z.object({ type: z.literal('import-workspace'), data: z.unknown() }),
])
export class ResearchService implements ResearchClient {
  private active = new Map<string, AbortController>()
  get hasActiveRuns() {
    return this.active.size > 0 || this.modelRuntime.auth.pending || this.agentRuntime.pending
  }
  constructor(
    readonly store: ResearchStore,
    private readonly modelRuntime: Pick<
      PiModels,
      'connect' | 'providers' | 'generate' | 'auth' | 'shutdown'
    > = new PiModels(store),
    private readonly agentRuntime = new AcpAgents(store.directory),
    private readonly network: Network = defaultNetwork,
  ) {}
  get agent(): NonNullable<ResearchClient['agent']> {
    return this.agentRuntime
  }
  async modelProviders() {
    return this.modelRuntime.providers()
  }
  get auth(): ResearchClient['auth'] {
    return {
      start: async (input, type) => {
        if (this.active.size) throw new Error('请等待当前研究结束后连接账号')
        return this.modelRuntime.auth.start(
          { ...this.store.settings(), ...settingsSchema.parse(input) },
          z.enum(['oauth', 'api_key']).parse(type),
        )
      },
      status: (sessionId) => this.modelRuntime.auth.status(id.parse(sessionId)),
      respond: (sessionId, promptId, value) =>
        this.modelRuntime.auth.respond(
          id.parse(sessionId),
          id.parse(promptId),
          z.string().max(16000).parse(value),
        ),
      cancel: (sessionId) => this.modelRuntime.auth.cancel(id.parse(sessionId)),
      logout: async (input) => {
        if (this.active.size) throw new Error('请等待当前研究结束后退出账号')
        return this.modelRuntime.auth.logout({
          ...this.store.settings(),
          ...settingsSchema.parse(input),
        })
      },
    }
  }
  async snapshot(): Promise<Snapshot>
  async snapshot(sinceVersion: number): Promise<Snapshot | null>
  async snapshot(sinceVersion?: number): Promise<Snapshot | null> {
    return sinceVersion === undefined
      ? this.store.snapshot()
      : this.store.snapshot(
          z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(sinceVersion),
        )
  }
  async exportWorkspace(id: string) {
    return this.store.exportWorkspace(id)
  }
  async testConnection(input?: SettingsInput) {
    const saved = this.store.settings()
    const candidate = input === undefined ? undefined : settingsSchema.parse(input)
    const settings = { ...saved, ...candidate }
    // Connecting previews these settings without saving them. Existing credentials
    // can only be reused for the same provider and exact endpoint.
    const sameEndpoint = modelConnectionKey(settings) === modelConnectionKey(saved)
    const apiKey = candidate?.clearApiKey
      ? ''
      : candidate?.apiKey?.trim() || (sameEndpoint ? this.store.credentials().apiKey : '')
    try {
      return await this.modelRuntime.connect(settings, apiKey, !!candidate?.clearApiKey)
    } catch (error) {
      const message = error instanceof Error ? error.message : '连接失败'
      throw new Error(apiKey ? message.replaceAll(apiKey, '[密钥已隐藏]') : message)
    }
  }
  async command(input: AppCommand): Promise<{ id?: string }> {
    const command = commandSchema.parse(input)
    switch (command.type) {
      case 'create-workspace':
        return {
          id: this.store.createWorkspace(command.question, command.name, command.constraints),
        }
      case 'create-node':
        return {
          id: this.store.createNode(
            command.parentId,
            command.question,
            command.sourceReportId,
            command,
          ),
        }
      case 'edit-node':
        this.store.editNode(command.nodeId, command.question)
        break
      case 'remove-branch':
        this.store.removeBranch(command.nodeId, command.requestId)
        break
      case 'restore-branch':
        this.store.restoreBranch(command.nodeId, command.removalId)
        break
      case 'save-view':
        this.store.saveView(command.workspaceId, command.view)
        break
      case 'save-settings':
        this.store.saveSettings(command.settings)
        break
      case 'import-workspace':
        return { id: this.store.importWorkspace(command.data) }
      case 'cancel-research': {
        const run = this.store.run(command.runId)
        if (run.status === 'running') {
          this.active.get(run.id)?.abort()
          this.store.saveRun({
            ...run,
            status: 'cancelled',
            phase: '已停止',
            finishedAt: new Date().toISOString(),
          })
        }
        break
      }
      case 'send-message':
      case 'start-research': {
        if (this.store.node(command.nodeId).removedAt) throw new Error('此分支已移除，请先恢复')
        const snapshot = this.store.snapshot(),
          settings = snapshot.settings,
          credentials = this.store.credentials(),
          chat = command.type === 'send-message',
          instruction = chat ? command.message : command.instruction
        if (settings.backend === 'acp') {
          if (!settings.agent) throw new Error('请先连接智能体')
        } else if (!settings.model.trim()) throw new Error('请先在模型设置中填写模型名称')
        if (snapshot.runs.some((r) => r.nodeId === command.nodeId && r.status === 'running'))
          throw new Error('此节点已有研究正在进行')
        if (this.active.size >= 3) throw new Error('最多同时进行三项研究，请等待或取消已有研究')
        const context = buildContext(
          snapshot,
          command.nodeId,
          instruction,
          command.type === 'start-research' ? command.reportIds : [],
          chat ? 'chat' : 'research',
          0,
          settings.backend !== 'acp',
        )
        const selected = command.selectedReportId
          ? this.store.report(command.selectedReportId)
          : branchReport(snapshot, command.nodeId, snapshot.views[context.workspaceId])
        if (
          selected &&
          (selected.nodeId !== command.nodeId || selected.workspaceId !== context.workspaceId)
        )
          throw new Error('当前查看的报告不属于本轮研究节点')
        const run: ResearchRun = {
          id: randomUUID(),
          workspaceId: context.workspaceId,
          nodeId: command.nodeId,
          instruction,
          selectedReportId: selected?.id,
          status: 'running',
          phase: '准备研究材料',
          output: '',
          error: '',
          model:
            settings.backend === 'acp'
              ? settings.agent?.name || settings.agent?.kind || 'ACP'
              : settings.model,
          ...(settings.backend === 'acp'
            ? { agent: { name: settings.agent?.name || 'ACP', activities: [], requests: [] } }
            : {}),
          provider: settings.provider,
          ...(chat ? { mode: 'chat' as const } : {}),
          context,
          createdAt: new Date().toISOString(),
        }
        this.store.saveRun(run)
        const controller = new AbortController()
        this.active.set(run.id, controller)
        void this.perform(run.id, settings, credentials, controller.signal).finally(() =>
          this.active.delete(run.id),
        )
        return { id: run.id }
      }
    }
    return {}
  }
  private async perform(
    runId: string,
    settings: ReturnType<ResearchStore['settings']>,
    credentials: { apiKey: string; searchKey: string },
    signal: AbortSignal,
  ) {
    let lastWrite = 0,
      raw = ''
    let agentState: AgentRun | undefined
    let requestVersion = ''
    let modelProgress: ModelProgress | undefined
    const patch = (updates: Partial<ResearchRun>) => {
      const current = this.store.run(runId)
      if (current.status === 'running') this.store.saveRun({ ...current, ...updates })
    }
    try {
      const run = this.store.run(runId),
        node = this.store.node(run.nodeId),
        context = structuredClone(run.context)
      if (settings.backend === 'acp' && settings.agent) {
        patch({ phase: run.mode === 'chat' ? '等待智能体响应' : '正在生成报告' })
        const tools = await openResearchMcp(this.store, runId, signal)
        const result = await this.agentRuntime
          .run(
            settings.agent,
            context,
            signal,
            (output, agent) => {
              raw = output
              agentState = agent
              const nextVersion = JSON.stringify(
                agent.requests.map((request) => [request.id, request.status]),
              )
              const requestsChanged = requestVersion !== nextVersion
              requestVersion = nextVersion
              const waiting = agent.requests.some((request) => request.status === 'pending')
              if (Date.now() - lastWrite > 350 || requestsChanged) {
                patch({
                  output,
                  agent,
                  phase: waiting
                    ? '等待你的回应'
                    : agent.activities.some((activity) =>
                          ['pending', 'in_progress'].includes(activity.status),
                        )
                      ? '正在调用工具'
                      : output
                        ? '正在回复'
                        : run.mode === 'chat'
                          ? '等待智能体响应'
                          : '正在生成报告',
                })
                lastWrite = Date.now()
              }
            },
            tools.servers,
          )
          .finally(() => tools.close())
        raw = result.raw
        if (signal.aborted) return
        patch({ output: raw, agent: result.agent, model: result.model })
        if (run.mode === 'chat') {
          patch({ status: 'completed', phase: '对话已保存', finishedAt: new Date().toISOString() })
          return
        }
        let parsed: unknown
        const answer = result.answer.trim()
        try {
          parsed = JSON.parse(
            answer
              .trim()
              .replace(/^```(?:json)?\s*/i, '')
              .replace(/\s*```$/, ''),
          )
        } catch {
          /* Native agents may return the complete report as Markdown. */
        }
        const structured = ResearchOutputSchema.safeParse(parsed)
        if (parsed !== undefined && !structured.success)
          throw new Error('智能体返回的报告结构不完整，原文已保存')
        if (!structured.success && answer.length < 20)
          throw new Error('智能体未返回完整报告，已有内容已保存')
        const output = structured.success
          ? structured.data
          : {
              title: node.title,
              summary: answer
                .replace(/[#*`>]/g, '')
                .trim()
                .slice(0, 500),
              findings: [],
              openQuestions: [],
              report: answer,
              followups: [],
            }
        if (!ResearchOutputSchema.safeParse(output).success)
          throw new Error('智能体报告超过保存限制或结构不完整，原文已保存')
        const links = [...output.report.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)]
        const reportedSources = [...context.sources]
        const known = new Set(context.sources.map((source) => source.url))
        for (const [, title, url] of links) {
          if (known.has(url)) continue
          known.add(url)
          const source = SourceSchema.safeParse({
            id: randomUUID(),
            title,
            url,
            excerpt: '智能体提供的引用；QB 未独立核验。',
          })
          if (source.success && reportedSources.length < 100) reportedSources.push(source.data)
        }
        context.limitations.push('外部工具由原生智能体执行；工具完成不代表研究主张已被 QB 核验。')
        patch({ context })
        this.store.complete(runId, output, reportedSources)
        return
      }
      if (credentials.searchKey && run.mode !== 'chat') {
        patch({ phase: '检索相关公开资料' })
        const sources = await this.network.run(
          { operation: 'web-search', provider: 'tavily' },
          () =>
            webSearch(
              `${node.question}\n${run.instruction}`,
              credentials.searchKey,
              signal,
              this.network.fetch,
            ),
        )
        const included = []
        for (const source of sources) {
          const content = `\n本次检索资料（外部主张，需审慎判断）：${JSON.stringify(source)}`
          if (context.estimatedTokens + estimateTokens(content) + 300 <= context.budget) {
            context.messages[1].content += content
            context.estimatedTokens += estimateTokens(content)
            included.push(source)
          } else context.limitations.push(`因上下文预算省略检索结果：${source.title}`)
        }
        context.sources = [
          ...new Map([...context.sources, ...included].map((s) => [s.url, s])).values(),
        ]
        if (!sources.length) context.limitations.push('本次外部检索未返回资料。')
      } else {
        context.limitations.push(
          '本次未启用外部检索，模型基于已有研究材料与自身知识进行分析；新增主张尚未独立核验。',
        )
        context.messages[1].content +=
          '\n本次没有进行外部检索。明确说明依赖已有研究材料与模型知识，不可声称已检索或核验新资料。'
      }
      if (signal.aborted) return
      patch({
        context,
        phase: run.mode === 'chat' ? '正在回复当前节点的讨论' : '模型正在研究与撰写报告',
      })
      const onChunk = (output: string) => {
        raw = output
        if (Date.now() - lastWrite > 350) {
          patch({ output })
          lastWrite = Date.now()
        }
      }
      const output = await this.modelRuntime.generate(
        settings,
        credentials.apiKey,
        context.messages,
        signal,
        onChunk,
        run.mode === 'chat' ? undefined : ResearchOutputSchema,
        (selection) => patch(selection),
        {
          tools: researchTools(this.store, runId, signal),
          progress: (value) => {
            modelProgress = value
            patch(value)
          },
        },
        { runId, context, onTrace: (session) => patch({ session }) },
      )
      raw = output.raw
      if (signal.aborted) {
        const current = this.store.run(runId)
        if (raw || agentState || modelProgress)
          this.store.saveRun({
            ...current,
            output: raw || current.output,
            ...(agentState ? { agent: agentState } : {}),
            ...(modelProgress
              ? { activities: modelProgress.activities, toolCalls: modelProgress.toolCalls }
              : {}),
          })
        return
      }
      if (run.mode === 'chat') {
        patch({
          output: raw,
          phase: '对话已保存',
          status: 'completed',
          finishedAt: new Date().toISOString(),
        })
        return
      }
      patch({ output: raw, phase: '整理报告与后续研究方向' })
      let parsed: unknown
      try {
        parsed =
          output.report ??
          JSON.parse(
            raw
              .trim()
              .replace(/^```(?:json)?\s*/i, '')
              .replace(/\s*```$/, ''),
          )
      } catch {
        throw new Error(
          '模型输出未采用约定的 JSON 格式，原文已保存。可在设置中启用 JSON 模式后重试。',
        )
      }
      const result = ResearchOutputSchema.safeParse(parsed)
      if (!result.success)
        throw new Error('模型返回的报告结构不完整。原始输出已保存，可重试或调整模型。')
      const allowed = new Set(context.sources.map((s) => s.url)),
        links = [...result.data.report.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)].map((m) => m[1])
      const unknown = links.filter((link) => !allowed.has(link))
      if (unknown.length) {
        context.limitations.push('模型输出包含未提供的链接，已从报告中移除；不能视为检索证据。')
        result.data.report = result.data.report.replace(
          /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
          (full, label, url) =>
            allowed.has(url) ? full : `${label}（模型提供的链接未核验，已省略）`,
        )
        patch({ context })
      }
      if (!credentials.searchKey)
        result.data.report +=
          '\n\n---\n\n**资料范围**：本次未进行外部检索。内容基于已有报告与模型知识，其中新增主张尚未独立核验。'
      this.store.complete(runId, result.data)
    } catch (error) {
      const current = this.store.run(runId)
      if (current.status === 'cancelled' || current.status === 'interrupted') {
        if (raw || agentState || modelProgress)
          this.store.saveRun({
            ...current,
            output: raw || current.output,
            ...(agentState ? { agent: agentState } : {}),
            ...(modelProgress
              ? { activities: modelProgress.activities, toolCalls: modelProgress.toolCalls }
              : {}),
          })
      } else if (current.status === 'running') {
        let message = error instanceof Error ? error.message : '研究未能完成'
        for (const secret of Object.values(credentials))
          if (secret) message = message.replaceAll(secret, '[密钥已隐藏]')
        this.store.saveRun({
          ...current,
          status: signal.aborted ? 'cancelled' : 'failed',
          output: raw || current.output,
          ...(agentState ? { agent: agentState } : {}),
          error: message,
          phase: signal.aborted ? '已停止' : current.mode === 'chat' ? '回复未完成' : '报告未完成',
          finishedAt: new Date().toISOString(),
        })
      }
    }
  }
  shutdown() {
    this.agentRuntime.shutdown()
    this.modelRuntime.shutdown()
    for (const [id, controller] of this.active) {
      controller.abort()
      const run = this.store.run(id)
      if (run.status === 'running')
        this.store.saveRun({
          ...run,
          status: 'interrupted',
          phase: run.mode === 'chat' ? '应用关闭，回复中断' : '应用关闭，报告中断',
          finishedAt: new Date().toISOString(),
        })
    }
    this.active.clear()
  }
}
