import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ResearchStore, viewSchema } from './store'
import { buildContext, estimateTokens } from '../research/context'
import {
  ResearchOutputSchema,
  type AppCommand,
  type ResearchClient,
  type ResearchRun,
} from '../research/types'
import { generate, listModels, webSearch } from '../research/providers'
import { CodexAdapter } from './codex'

const id = z.string().min(1).max(200),
  question = z.string().trim().min(1, '请输入研究问题').max(6000),
  key = z.string().max(1000).optional()
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
    question,
    relatedIds: z.array(id).max(10).optional(),
  }),
  z.object({ type: z.literal('edit-node'), nodeId: id, question }),
  z.object({ type: z.literal('save-view'), workspaceId: id, view: viewSchema }),
  z.object({
    type: z.literal('save-settings'),
    settings: z.object({
      provider: z.enum(['compatible', 'ollama', 'codex']),
      baseUrl: z.url().max(1000),
      model: z.string().max(200),
      jsonMode: z.boolean(),
      contextBudget: z.number().int().min(4000).max(128000),
      apiKey: key,
      searchKey: key,
      clearApiKey: z.boolean().optional(),
      clearSearchKey: z.boolean().optional(),
      codexPath: z.string().max(2000).optional(),
    }),
  }),
  z.object({
    type: z.literal('start-research'),
    nodeId: id,
    instruction: z.string().trim().max(12000),
    reportIds: z.array(id).max(20).optional(),
  }),
  z.object({ type: z.literal('cancel-research'), runId: id }),
  z.object({
    type: z.literal('send-message'),
    nodeId: id,
    message: z.string().trim().min(1, '请输入对话内容').max(12000),
  }),
  z.object({ type: z.literal('import-workspace'), data: z.unknown() }),
])
export class ResearchService implements ResearchClient {
  private active = new Map<string, AbortController>()
  get hasActiveRuns() {
    return this.active.size > 0
  }
  constructor(
    readonly store: ResearchStore,
    private readonly codex: Pick<CodexAdapter, 'test' | 'generate'> = new CodexAdapter(
      store.directory,
    ),
  ) {}
  async snapshot() {
    return this.store.snapshot()
  }
  async exportWorkspace(id: string) {
    return this.store.exportWorkspace(id)
  }
  async testConnection() {
    if (this.store.settings().provider === 'codex') return this.codex.test(this.store.settings())
    return { models: await listModels(this.store.settings(), this.store.credentials().apiKey) }
  }
  async command(input: AppCommand): Promise<{ id?: string }> {
    const command = commandSchema.parse(input)
    switch (command.type) {
      case 'create-workspace':
        return {
          id: this.store.createWorkspace(command.question, command.name, command.constraints),
        }
      case 'create-node':
        return { id: this.store.createNode(command.parentId, command.question, command.relatedIds) }
      case 'edit-node':
        this.store.editNode(command.nodeId, command.question)
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
            phase: '已取消研究',
            finishedAt: new Date().toISOString(),
          })
        }
        break
      }
      case 'send-message':
      case 'start-research': {
        const snapshot = this.store.snapshot(),
          settings = snapshot.settings,
          credentials =
            settings.provider === 'codex'
              ? { apiKey: '', searchKey: '' }
              : this.store.credentials(),
          chat = command.type === 'send-message',
          instruction = chat ? command.message : command.instruction
        if (settings.provider !== 'codex' && !settings.model.trim())
          throw new Error('请先在模型设置中填写模型名称')
        if (
          settings.provider === 'compatible' &&
          settings.baseUrl.includes('api.openai.com') &&
          !credentials.apiKey
        )
          throw new Error('请先在模型设置中填写 API Key')
        if (snapshot.runs.some((r) => r.nodeId === command.nodeId && r.status === 'running'))
          throw new Error('此节点已有研究正在进行')
        if (this.active.size >= 3) throw new Error('最多同时进行三项研究，请等待或取消已有研究')
        const context = buildContext(
          snapshot,
          command.nodeId,
          instruction,
          command.type === 'start-research' ? command.reportIds : [],
          chat ? 'chat' : 'research',
        )
        const run: ResearchRun = {
          id: randomUUID(),
          workspaceId: context.workspaceId,
          nodeId: command.nodeId,
          instruction,
          status: 'running',
          phase: '准备研究材料',
          output: '',
          error: '',
          model: settings.model || 'Codex 默认模型',
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
    const patch = (updates: Partial<ResearchRun>) => {
      const current = this.store.run(runId)
      if (current.status === 'running') this.store.saveRun({ ...current, ...updates })
    }
    try {
      const run = this.store.run(runId),
        node = this.store.node(run.nodeId),
        context = structuredClone(run.context)
      if (credentials.searchKey) {
        patch({ phase: '检索相关公开资料' })
        const sources = await webSearch(
          `${node.question}\n${run.instruction}`,
          credentials.searchKey,
          signal,
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
      raw =
        settings.provider === 'codex'
          ? await this.codex.generate(
              settings,
              context,
              signal,
              onChunk,
              (session) =>
                patch({
                  model: session.model,
                  codex: {
                    threadId: session.threadId,
                    ...(session.turnId ? { turnId: session.turnId } : {}),
                  },
                }),
              run.mode === 'chat' ? undefined : z.toJSONSchema(ResearchOutputSchema),
            )
          : await generate(
              { ...settings, jsonMode: run.mode === 'chat' ? false : settings.jsonMode },
              credentials.apiKey,
              context.messages,
              signal,
              onChunk,
            )
      if (signal.aborted) {
        const current = this.store.run(runId)
        if (raw) this.store.saveRun({ ...current, output: raw })
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
        parsed = JSON.parse(
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
        if (raw) this.store.saveRun({ ...current, output: raw })
      } else if (current.status === 'running') {
        let message = error instanceof Error ? error.message : '研究未能完成'
        for (const secret of Object.values(credentials))
          if (secret) message = message.replaceAll(secret, '[密钥已隐藏]')
        this.store.saveRun({
          ...current,
          status: signal.aborted ? 'cancelled' : 'failed',
          output: raw || current.output,
          error: message,
          phase: signal.aborted ? '已取消研究' : '研究未完成',
          finishedAt: new Date().toISOString(),
        })
      }
    }
  }
  shutdown() {
    for (const [id, controller] of this.active) {
      controller.abort()
      const run = this.store.run(id)
      if (run.status === 'running')
        this.store.saveRun({
          ...run,
          status: 'interrupted',
          phase: '应用关闭，研究中断',
          finishedAt: new Date().toISOString(),
        })
    }
    this.active.clear()
  }
}
