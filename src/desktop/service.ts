import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ResearchStore } from './store'
import { commandSchema, settingsSchema, id } from './command-schemas'
import { buildContext, estimateTokens } from '../research/context'
import {
  ResearchOutputSchema,
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
import { AcpSessions, AgentSessionRestoreError } from './acp-sessions'
import { openResearchMcp } from './research-mcp'
import type { AgentRun } from '../research/agent'
import { branchReport } from '../research/branching'
import { defaultNetwork, type Network } from './network'
import { researchTools } from './research-tools'
import { type ModelProgress } from './model-tool-turn'
import { ResearchRunLifecycle } from './run-lifecycle'

export class ResearchService implements ResearchClient {
  private active = new Map<string, AbortController>()
  private readonly agentSessions: AcpSessions
  get hasActiveRuns() {
    return this.active.size > 0 || this.modelRuntime.auth.pending || this.agentRuntime.pending
  }
  get hasPendingConnection() {
    return this.modelRuntime.auth.pending || this.agentRuntime.pending
  }
  constructor(
    readonly store: ResearchStore,
    private readonly modelRuntime: Pick<
      PiModels,
      'connect' | 'providers' | 'generate' | 'auth' | 'shutdown'
    > = new PiModels(store),
    private readonly agentRuntime = new AcpAgents(store.directory, store.agentWorkingDirectory),
    private readonly network: Network = defaultNetwork,
  ) {
    this.agentSessions = new AcpSessions(store)
  }
  get agent(): NonNullable<ResearchClient['agent']> {
    return this.agentRuntime
  }
  ownsAgentConnection(id: string) {
    return this.agentRuntime.owns(id)
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
  async resetAgentSession(runId: string) {
    const run = this.store.run(id.parse(runId))
    if (run.status !== 'failed' || !run.agentSessionBindingId)
      throw new Error('此记录没有可重建的本机智能体会话')
    if (
      this.store
        .snapshot()
        .runs.some((active) => active.nodeId === run.nodeId && active.status === 'running')
    )
      throw new Error('请先停止此节点的当前回复')
    if (!this.agentSessions.retire(run.nodeId, run.agentSessionBindingId))
      throw new Error('此记录关联的本机会话已不再有效')
    return { id: run.id }
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
        new ResearchRunLifecycle(this.store, command.runId).cancel(() =>
          this.active.get(command.runId)?.abort(),
        )
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
    const lifecycle = new ResearchRunLifecycle(this.store, runId)
    const patch = (updates: Partial<ResearchRun>) => lifecycle.update(updates)
    const progress = () => ({
      output: raw,
      agent: agentState,
      ...(modelProgress
        ? { activities: modelProgress.activities, toolCalls: modelProgress.toolCalls }
        : {}),
    })
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
              const nextVersion = JSON.stringify([
                agent.input?.submittedAt,
                agent.requests.map((request) => [request.id, request.status]),
              ])
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
            this.agentSessions.scope(run.nodeId, settings.agent, runId),
          )
          .finally(() => tools.close())
        raw = result.raw
        if (signal.aborted) return
        patch({ output: raw, agent: result.agent, model: result.model })
        if (run.mode === 'chat') {
          lifecycle.completeChat()
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
        lifecycle.preserve(progress())
        return
      }
      if (run.mode === 'chat') {
        lifecycle.completeChat(raw)
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
      lifecycle.fail(error, {
        cancelled: signal.aborted,
        progress: progress(),
        secrets: Object.values(credentials),
        agentSessionBindingId:
          error instanceof AgentSessionRestoreError ? error.bindingId : undefined,
      })
    }
  }
  shutdown() {
    this.agentRuntime.shutdown()
    this.modelRuntime.shutdown()
    for (const [id, controller] of this.active) {
      new ResearchRunLifecycle(this.store, id).interrupt()
      controller.abort()
    }
    this.active.clear()
  }
}
