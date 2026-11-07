import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { SqliteSessionArchive } from './session-archive'
import {
  defaultSettings,
  palette,
  type Workspace,
  type ResearchNode,
  type Report,
  type ResearchRun,
  type ConversationMessage,
  type Snapshot,
  type SettingsInput,
  type Settings,
  type ViewState,
  type ResearchOutput,
  type Source,
  SourceSchema,
  ReasoningEffortSchema,
  ResearchOutputSchema,
} from '../research/types'
import { starterResearch } from '../research/seed'
import { AgentConfigSchema, AgentRunSchema, AgentActivitySchema } from '../research/agent'
import {
  BranchRequestSchema,
  branchPrerequisite,
  type BranchRequest,
  type BranchReceipt,
} from '../research/branching'
import {
  apiProtocol,
  httpConnectionKey,
  modelConnectionKey,
  modelProviderId,
  sessionStrategy,
} from '../research/api-services'

export interface CredentialCodec {
  encrypt(value: string): string
  decrypt(value: string): string
}
const text = z.string().max(100_000),
  id = z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
    .refine(
      (value) => !['constructor', 'prototype', 'toString', 'hasOwnProperty'].includes(value),
      '记录编号无效',
    ),
  time = z.iso.datetime()
const workspaceSchema = z.object({
  id,
  name: text,
  question: text,
  objective: text,
  constraints: text,
  rootId: id,
  createdAt: time,
  updatedAt: time,
})
const nodeSchema = z.object({
  id,
  workspaceId: id,
  parentId: id.nullable(),
  removedAt: time.optional(),
  removalId: id.optional(),
  title: text,
  question: text,
  summary: text,
  openQuestions: z.array(text).max(100),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  relatedIds: z.array(id).max(100),
  createdAt: time,
  updatedAt: time,
  originReportId: id.optional(),
  referenceReportIds: z.array(id).max(20).optional(),
})
const reportSchema = z.object({
  id,
  workspaceId: id,
  nodeId: id,
  title: text,
  markdown: text,
  summary: text,
  findings: z.array(text).max(100),
  openQuestions: z.array(text).max(100),
  sources: z.array(SourceSchema).max(100),
  createdAt: time,
  origin: z.enum(['ai', 'import']),
  model: text,
  runId: id.optional(),
  saveRequest: z
    .object({ id: z.string().min(1).max(200), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
    .optional(),
})
const contextSchema = z.object({
  policy: z.literal('branch-v1'),
  createdAt: time,
  workspaceId: id,
  nodeId: id,
  path: z.array(id),
  items: z.array(
    z.object({
      reportId: id,
      nodeId: id,
      title: text,
      reason: text,
      included: z.boolean(),
      excerpted: z.boolean(),
    }),
  ),
  sources: z.array(SourceSchema),
  messages: z.array(
    z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().max(400000) }),
  ),
  conversation: z
    .object({ includedMessageIds: z.array(id), omittedMessageIds: z.array(id) })
    .optional(),
  estimatedTokens: z.number().nonnegative(),
  budget: z.number().positive(),
  limitations: z.array(text),
})
const runSchema = z.object({
  session: z
    .object({
      sessionId: id,
      bootstrapMessageIds: z.array(z.string()),
      requests: z.array(
        z.object({
          revision: z.number().int().nonnegative(),
          strategy: z.enum(['portable', 'native']),
          checkpointId: z.string().nullable(),
          origin: z.string(),
          modelId: z.string(),
          contextWindow: z.number().positive(),
          inputTokens: z.number().nonnegative(),
          request: z.unknown(),
        }),
      ),
    })
    .optional(),
  activities: z.array(AgentActivitySchema).max(500).optional(),
  toolCalls: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        name: text,
        arguments: z.unknown(),
        result: z.unknown().optional(),
        error: text.optional(),
      }),
    )
    .max(100)
    .optional(),
  agent: AgentRunSchema.optional(),
  id,
  workspaceId: id,
  nodeId: id,
  instruction: text,
  status: z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted']),
  phase: text,
  output: z.string().max(180000),
  error: text,
  model: text,
  reasoningEffort: ReasoningEffortSchema.optional(),
  context: contextSchema,
  createdAt: time,
  finishedAt: time.optional(),
  reportId: id.optional(),
  mode: z.literal('chat').optional(),
  selectedReportId: id.optional(),
  provider: z.enum(['compatible', 'ollama', 'codex', 'account']).optional(),
  api: z.object({ protocol: z.string().max(100), baseUrl: z.url().max(1000) }).optional(),
  codex: z.object({ threadId: id, turnId: id.optional() }).optional(),
  pi: z
    .object({
      provider: z.string().max(200),
      api: z.string().max(100),
      responseId: text.optional(),
    })
    .optional(),
})
const messageSchema = z.object({
  id,
  workspaceId: id,
  nodeId: id,
  runId: id,
  role: z.enum(['user', 'assistant']),
  content: z.string().max(180000),
  createdAt: time,
})
const viewportSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  zoom: z.number().min(0.001).max(5),
})
const positionsSchema = z.record(id, z.object({ x: z.number().finite(), y: z.number().finite() }))
const graphFrameSchema = z.object({
  mode: z.enum(['horizontal', 'mindmap', 'outline']),
  detail: z.enum(['summary', 'compact']),
  focusId: id.optional(),
})
export const viewSchema = z.object({
  revision: z.number().nonnegative().optional(),
  selectedId: id,
  collapsed: z.array(id).max(5000),
  drafts: z.record(id, z.string().max(12000)),
  chatDrafts: z.record(id, z.string().max(12000)).optional(),
  readers: z
    .record(
      id,
      z.object({
        tab: z.enum(['chat', 'report', 'sources', 'records']),
        reportId: id.optional(),
        scroll: z.record(z.string().max(220), z.number().finite().nonnegative()).optional(),
        composerOpen: z.boolean().optional(),
        overviewOpen: z.boolean().optional(),
        questionOpen: z.boolean().optional(),
      }),
    )
    .optional(),
  viewport: viewportSchema.optional(),
  positions: positionsSchema.optional(),
  graph: z
    .object({
      mode: z.enum(['horizontal', 'mindmap', 'outline']).optional(),
      detail: z.enum(['summary', 'compact']).optional(),
      focusId: id.optional(),
      branchSides: z.record(id, z.enum(['left', 'right'])).optional(),
      noticedNodeIds: z.array(id).max(10000).optional(),
      history: z
        .array(
          graphFrameSchema.extend({
            selectedId: id,
            collapsed: z.array(id).max(5000).optional(),
            viewport: viewportSchema.optional(),
          }),
        )
        .max(20)
        .optional(),
      scenes: z
        .array(
          graphFrameSchema.extend({
            viewport: viewportSchema.optional(),
            positions: positionsSchema.optional(),
          }),
        )
        .max(64)
        .optional(),
    })
    // Accept retired outline views at the storage/import boundary only. Do not
    // map their scenes onto horizontal ones and overwrite existing camera memory.
    .transform((graph) => ({
      ...graph,
      mode: graph.mode === 'outline' ? ('horizontal' as const) : graph.mode,
      history: graph.history?.map((frame) => ({
        ...frame,
        mode: frame.mode === 'outline' ? ('horizontal' as const) : frame.mode,
      })),
      scenes: graph.scenes?.flatMap((scene) =>
        scene.mode === 'outline' ? [] : [{ ...scene, mode: scene.mode }],
      ),
    }))
    .optional(),
})
const editSchema = z.object({ nodeId: id, previous: nodeSchema, createdAt: time })
const branchReceiptSchema = z.object({
  requestId: z.string().min(1).max(200),
  workspaceId: id,
  parentId: id,
  sourceReportId: id,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  nodeIds: z.array(id).min(1).max(20),
})
const exportSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  modelSessions: z.unknown().optional(),
  workspace: workspaceSchema,
  nodes: z.array(nodeSchema).min(1).max(10000),
  reports: z.array(reportSchema).max(20000),
  runs: z.array(runSchema).max(20000),
  messages: z.array(messageSchema).max(40000).default([]),
  edits: z.array(editSchema).max(50000).default([]),
  branchRequests: z.array(branchReceiptSchema).max(20000).default([]),
  view: viewSchema.optional(),
})

export class ResearchStore {
  private db: DatabaseSync
  private codec: CredentialCodec
  readonly sessions: SqliteSessionArchive
  private transactionDepth = 0
  constructor(
    readonly directory: string,
    options: { seed?: boolean; codec?: CredentialCodec; recoverRuns?: boolean } = {},
  ) {
    mkdirSync(directory, { recursive: true })
    this.codec = options.codec ?? localCodec(directory)
    this.db = new DatabaseSync(join(directory, 'research.sqlite'))
    if (Number(this.db.prepare('PRAGMA user_version').get()!.user_version) > 3) {
      this.db.close()
      throw new Error('数据库由较新的问之版本创建，请使用对应版本打开')
    }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      INSERT OR IGNORE INTO meta VALUES ('version',0);
      CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), parent_id TEXT REFERENCES nodes(id), payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS nodes_workspace ON nodes(workspace_id);
      CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), node_id TEXT NOT NULL REFERENCES nodes(id), payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS reports_node ON reports(node_id);
      CREATE TABLE IF NOT EXISTS branch_requests (workspace_id TEXT NOT NULL REFERENCES workspaces(id), request_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(workspace_id, request_id));
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), node_id TEXT NOT NULL REFERENCES nodes(id), payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS views (workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS node_edits (id INTEGER PRIMARY KEY, node_id TEXT NOT NULL REFERENCES nodes(id), previous TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), node_id TEXT NOT NULL REFERENCES nodes(id), run_id TEXT NOT NULL REFERENCES runs(id), role TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(run_id,role));
      CREATE INDEX IF NOT EXISTS messages_node ON messages(node_id);
      PRAGMA user_version=3;`)
    this.sessions = new SqliteSessionArchive(this.db)
    if (options.seed !== false && !this.all<Workspace>('workspaces').length) {
      const initial = starterResearch()
      this.transaction(() => {
        this.insertWorkspace(initial.workspace)
        initial.nodes.forEach((n) => this.insertNode(n))
        initial.reports.forEach((r) => this.insertReport(r))
        this.saveView(initial.workspace.id, { selectedId: 'visual', collapsed: [], drafts: {} })
      })
    }
    for (const run of this.all<ResearchRun>('runs').filter(
      (r) => options.recoverRuns !== false && r.status === 'running',
    ))
      this.saveRun({
        ...run,
        status: 'interrupted',
        phase: '研究已中断',
        error: '应用上次关闭时研究尚未完成。原始输出已保留，可重新发起研究。',
        finishedAt: new Date().toISOString(),
      })
  }
  private all<T>(table: 'workspaces' | 'nodes' | 'reports' | 'runs') {
    return (
      this.db.prepare(`SELECT payload FROM ${table} ORDER BY rowid`).all() as { payload: string }[]
    ).map((row) => JSON.parse(row.payload) as T)
  }
  private bump() {
    this.db.exec("UPDATE meta SET value=value+1 WHERE key='version'")
  }
  transaction<T>(fn: () => T): T {
    if (this.transactionDepth) return fn()
    this.db.exec('BEGIN IMMEDIATE')
    this.transactionDepth++
    try {
      const result = fn()
      this.bump()
      this.db.exec('COMMIT')
      return result
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    } finally {
      this.transactionDepth--
    }
  }
  snapshot(): Snapshot
  snapshot(sinceVersion: number): Snapshot | null
  snapshot(sinceVersion?: number): Snapshot | null {
    const version = Number(
      this.db.prepare("SELECT value FROM meta WHERE key='version'").get()!.value,
    )
    if (sinceVersion === version) return null
    const views = Object.fromEntries(
      (
        this.db.prepare('SELECT workspace_id,payload FROM views').all() as {
          workspace_id: string
          payload: string
        }[]
      ).map((row) => [row.workspace_id, viewSchema.parse(JSON.parse(row.payload))]),
    )
    return {
      version,
      workspaces: this.all<Workspace>('workspaces'),
      nodes: this.all<ResearchNode>('nodes'),
      reports: this.all<Report>('reports'),
      runs: this.all<ResearchRun>('runs'),
      messages: (
        this.db.prepare('SELECT payload FROM messages ORDER BY rowid').all() as {
          payload: string
        }[]
      ).map((row) => JSON.parse(row.payload) as ConversationMessage),
      views,
      settings: this.settings(),
      storage: { directory: this.directory, database: join(this.directory, 'research.sqlite') },
    }
  }
  private putSetting(key: string, payload: string) {
    this.db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(key, payload)
  }
  private readSetting(key: string) {
    return (
      this.db.prepare('SELECT payload FROM settings WHERE key=?').get(key) as
        { payload: string } | undefined
    )?.payload
  }
  private apiKeyConnection(settings: Settings) {
    return (
      this.readSetting('apiKeyConnection') ??
      httpConnectionKey({
        ...settings,
        baseUrl: this.readSetting('apiKeyOrigin') ?? '',
        apiProtocol: 'openai-chat',
        anthropicWorkspaceId: '',
      })
    )
  }
  settings(): Settings {
    const saved = this.readSetting('preferences')
    const previous = saved
      ? (JSON.parse(saved) as Omit<Settings, 'provider'> & {
          provider: Settings['provider'] | 'codex'
        })
      : undefined
    const provider =
      previous?.provider === 'codex' ? 'account' : (previous?.provider ?? defaultSettings.provider)
    const settings: Settings = {
      ...defaultSettings,
      backend: previous?.backend ?? 'model',
      agent: previous?.agent ? AgentConfigSchema.parse(previous.agent) : undefined,
      provider,
      modelProvider:
        previous?.modelProvider ||
        (previous?.provider === 'codex' || previous?.provider === 'account' || !previous
          ? 'openai'
          : 'custom'),
      baseUrl: previous?.provider === 'codex' ? '' : (previous?.baseUrl ?? defaultSettings.baseUrl),
      model: previous?.model ?? defaultSettings.model,
      reasoningEffort: previous?.reasoningEffort ?? '',
      apiProtocol: previous?.apiProtocol,
      anthropicWorkspaceId: previous?.anthropicWorkspaceId,
      maxOutputTokens: previous?.maxOutputTokens,
      sessionStrategy: sessionStrategy({ provider, sessionStrategy: previous?.sessionStrategy }),
      sessionInputBudget: previous?.sessionInputBudget,
      modelContextWindow: previous?.modelContextWindow,
      jsonMode: previous?.jsonMode ?? defaultSettings.jsonMode,
      contextBudget: previous?.contextBudget ?? defaultSettings.contextBudget,
    }
    // OAuth and API connections use separate encrypted scopes. Legacy API keys
    // are read only for their original exact endpoint until explicitly saved.
    const credential = this.readModelCredential(modelConnectionKey(settings)) as
      { type?: string } | undefined
    return {
      ...settings,
      hasApiKey: !!(
        credential?.type === 'api_key' ||
        (settings.provider !== 'account' &&
          modelProviderId(settings) === 'custom' &&
          this.readSetting('apiKey') &&
          this.apiKeyConnection(settings) === httpConnectionKey(settings))
      ),
      hasSearchKey: !!(this.readSetting('searchKey') || process.env.TAVILY_API_KEY),
    }
  }
  credentials(): { apiKey: string; searchKey: string } {
    const read = (name: string, fallback?: string) => {
      const encrypted = this.readSetting(name)
      return encrypted ? this.codec.decrypt(encrypted) : (fallback ?? '')
    }
    const settings = this.settings()
    const credential = this.readModelCredential(modelConnectionKey(settings)) as
      { type?: string; key?: string } | undefined
    return {
      apiKey: settings.hasApiKey
        ? credential?.type === 'api_key'
          ? (credential.key ?? '')
          : read('apiKey')
        : '',
      searchKey: read('searchKey', process.env.TAVILY_API_KEY),
    }
  }
  saveSettings(input: SettingsInput) {
    const previous = this.settings()
    if (input.baseUrl) {
      const url = new URL(input.baseUrl)
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error('服务地址应为不含密钥、查询参数或片段的 HTTP / HTTPS 地址')
    }
    if (
      input.backend !== 'acp' &&
      input.provider !== 'account' &&
      modelProviderId(input) === 'custom' &&
      !input.baseUrl
    )
      throw new Error('请填写自定义服务地址')
    const preferences = {
      backend: input.backend ?? 'model',
      agent: input.agent ? AgentConfigSchema.parse(input.agent) : previous.agent,
      provider: input.provider,
      modelProvider: modelProviderId(input),
      baseUrl: input.baseUrl.replace(/\/+$/, ''),
      apiProtocol: apiProtocol(input),
      ...(input.maxOutputTokens === undefined ? {} : { maxOutputTokens: input.maxOutputTokens }),
      anthropicWorkspaceId: input.anthropicWorkspaceId?.trim() ?? '',
      model: input.model.trim(),
      jsonMode: input.jsonMode,
      contextBudget: input.contextBudget,
      sessionStrategy: sessionStrategy(input),
      sessionInputBudget: input.sessionInputBudget,
      modelContextWindow: input.modelContextWindow,
      reasoningEffort: input.reasoningEffort ?? '',
    }
    this.transaction(() => {
      // Freeze a legacy key's original identity before changing preferences.
      if (this.readSetting('apiKey') && !this.readSetting('apiKeyConnection'))
        this.putSetting('apiKeyConnection', this.apiKeyConnection(previous))
      this.putSetting('preferences', JSON.stringify(preferences))
      if (input.backend !== 'acp' && input.provider !== 'account') {
        const scope = modelConnectionKey(preferences)
        if (input.clearApiKey) this.putModelCredential(scope, undefined)
        else {
          const current = this.readModelCredential(scope) as
            { type?: string; env?: Record<string, string> } | undefined
          const key = input.apiKey?.trim() || this.credentials().apiKey
          if (key && (input.apiKey?.trim() || !current))
            this.putModelCredential(scope, {
              type: 'api_key',
              key,
              ...(current?.type === 'api_key' && current.env ? { env: current.env } : {}),
            })
        }
        if (input.clearApiKey && this.apiKeyConnection(previous) === httpConnectionKey(preferences))
          this.db.prepare('DELETE FROM settings WHERE key=?').run('apiKey')
      }
      if (input.clearSearchKey) this.db.prepare('DELETE FROM settings WHERE key=?').run('searchKey')
      else if (input.searchKey?.trim())
        this.putSetting('searchKey', this.codec.encrypt(input.searchKey.trim()))
    })
  }
  private modelCredentialKey(scope: string) {
    return `piCredential:${createHash('sha256').update(scope).digest('hex')}`
  }
  readModelCredential(scope: string): unknown | undefined {
    const value = this.readSetting(this.modelCredentialKey(scope))
    return value ? JSON.parse(this.codec.decrypt(value)) : undefined
  }
  private putModelCredential(scope: string, value: unknown | undefined) {
    const key = this.modelCredentialKey(scope)
    if (value === undefined) this.db.prepare('DELETE FROM settings WHERE key=?').run(key)
    else this.putSetting(key, this.codec.encrypt(JSON.stringify(value)))
  }
  saveModelCredential(scope: string, value: unknown | undefined) {
    this.transaction(() => this.putModelCredential(scope, value))
  }
  installationId() {
    const existing = this.readSetting('piInstallationId')
    if (existing) return existing
    const value = randomUUID()
    this.transaction(() => this.putSetting('piInstallationId', value))
    return value
  }
  insertWorkspace(w: Workspace) {
    this.db.prepare('INSERT INTO workspaces VALUES (?,?)').run(w.id, JSON.stringify(w))
  }
  insertNode(n: ResearchNode) {
    this.db
      .prepare('INSERT INTO nodes VALUES (?,?,?,?)')
      .run(n.id, n.workspaceId, n.parentId, JSON.stringify(n))
  }
  insertReport(r: Report) {
    this.db
      .prepare('INSERT INTO reports VALUES (?,?,?,?)')
      .run(r.id, r.workspaceId, r.nodeId, JSON.stringify(r))
  }
  node(id: string): ResearchNode {
    const row = this.db.prepare('SELECT payload FROM nodes WHERE id=?').get(id) as
      { payload: string } | undefined
    if (!row) throw new Error('研究节点不存在')
    return JSON.parse(row.payload)
  }
  private updateNode(n: ResearchNode) {
    this.db.prepare('UPDATE nodes SET payload=? WHERE id=?').run(JSON.stringify(n), n.id)
  }
  createWorkspace(question: string, name?: string, constraints = '') {
    const now = new Date().toISOString(),
      wid = randomUUID(),
      nid = randomUUID()
    const workspace: Workspace = {
      id: wid,
      name: name?.trim() || question.slice(0, 30),
      question,
      objective: question,
      constraints,
      rootId: nid,
      createdAt: now,
      updatedAt: now,
    }
    const node: ResearchNode = {
      id: nid,
      workspaceId: wid,
      parentId: null,
      title: question.slice(0, 80),
      question,
      summary: '',
      openQuestions: [],
      relatedIds: [],
      color: palette[0],
      createdAt: now,
      updatedAt: now,
    }
    this.transaction(() => {
      this.insertWorkspace(workspace)
      this.insertNode(node)
      this.saveView(wid, { selectedId: nid, collapsed: [], drafts: {} })
    })
    return wid
  }
  report(id: string): Report {
    const row = this.db.prepare('SELECT payload FROM reports WHERE id=?').get(id) as
      { payload: string } | undefined
    if (!row) throw new Error('来源报告不存在')
    return JSON.parse(row.payload)
  }
  createNode(
    parentId: string,
    question: string,
    sourceReportId: string,
    options: {
      requestId?: string
      relatedIds?: string[]
      referenceReportIds?: string[]
    } = {},
  ) {
    return this.createBranches({
      ...options,
      parentId,
      sourceReportId,
      requestId: options.requestId ?? randomUUID(),
      branches: [{ question }],
    }).nodeIds[0]
  }
  createBranches(input: BranchRequest): BranchReceipt {
    return this.transaction(() => this.deriveBranches(input))
  }
  /** Called inside the same transaction that saves a report and its followups. */
  private deriveBranches(input: BranchRequest): BranchReceipt {
    if (!input.sourceReportId) throw new Error(branchPrerequisite)
    const request = BranchRequestSchema.parse(input)
    const parent = this.node(request.parentId),
      report = this.report(request.sourceReportId)
    if (parent.removedAt) throw new Error('父分支已移除，请先恢复')
    if (report.nodeId !== parent.id || report.workspaceId !== parent.workspaceId)
      throw new Error('来源报告必须属于父节点和同一研究空间')
    const relatedIds = [...new Set(request.relatedIds)].sort()
    const referenceReportIds = [...new Set(request.referenceReportIds)].sort()
    if (relatedIds.some((id) => this.node(id).workspaceId !== parent.workspaceId))
      throw new Error('相关研究必须属于当前研究空间')
    if (referenceReportIds.some((id) => this.report(id).workspaceId !== parent.workspaceId))
      throw new Error('引用的报告不属于当前研究空间')
    const branches = request.branches.map((branch) => ({
      question: branch.question,
      title: branch.title ?? branch.question.slice(0, 80),
    }))
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          parentId: parent.id,
          sourceReportId: report.id,
          branches,
          relatedIds,
          referenceReportIds,
        }),
      )
      .digest('hex')
    const previous = this.db
      .prepare('SELECT payload FROM branch_requests WHERE workspace_id=? AND request_id=?')
      .get(parent.workspaceId, request.requestId) as { payload: string } | undefined
    if (previous) {
      const receipt = JSON.parse(previous.payload) as BranchReceipt
      if (receipt.fingerprint !== fingerprint)
        throw new Error('创建请求编号已用于其他内容，请使用新的请求编号')
      return receipt
    }
    const siblings = this.all<ResearchNode>('nodes').filter((node) => node.parentId === parent.id)
    const nodeIds: string[] = [],
      now = new Date().toISOString()
    for (const branch of branches) {
      const existing = siblings.find(
        (node) =>
          node.originReportId === report.id &&
          node.question.trim() === branch.question &&
          JSON.stringify([...(node.referenceReportIds ?? [])].sort()) ===
            JSON.stringify(referenceReportIds) &&
          JSON.stringify([...node.relatedIds].sort()) === JSON.stringify(relatedIds),
      )
      if (existing) {
        if (existing.removedAt) throw new Error('相同方向已移除，请先恢复或提出不同问题')
        nodeIds.push(existing.id)
        continue
      }
      const child: ResearchNode = {
        id: randomUUID(),
        workspaceId: parent.workspaceId,
        parentId: parent.id,
        title: branch.title,
        question: branch.question,
        summary: '',
        openQuestions: [],
        relatedIds,
        referenceReportIds,
        originReportId: report.id,
        color: parent.parentId === null ? palette[siblings.length % palette.length] : parent.color,
        createdAt: now,
        updatedAt: now,
      }
      this.insertNode(child)
      siblings.push(child)
      nodeIds.push(child.id)
    }
    const receipt: BranchReceipt = {
      requestId: request.requestId,
      workspaceId: parent.workspaceId,
      parentId: parent.id,
      sourceReportId: report.id,
      fingerprint,
      nodeIds,
    }
    this.db
      .prepare('INSERT INTO branch_requests VALUES (?,?,?)')
      .run(parent.workspaceId, request.requestId, JSON.stringify(receipt))
    return receipt
  }
  editNode(nodeId: string, question: string) {
    const n = this.node(nodeId),
      now = new Date().toISOString()
    this.transaction(() => {
      this.db
        .prepare('INSERT INTO node_edits (node_id,previous,created_at) VALUES (?,?,?)')
        .run(nodeId, JSON.stringify(n), now)
      this.updateNode({ ...n, question, title: question.slice(0, 80), updatedAt: now })
      if (n.parentId === null) {
        const w = this.all<Workspace>('workspaces').find((w) => w.id === n.workspaceId)!
        this.db
          .prepare('UPDATE workspaces SET payload=? WHERE id=?')
          .run(JSON.stringify({ ...w, question, objective: question, updatedAt: now }), w.id)
      }
    })
  }
  removeBranch(nodeId: string, removalId: string) {
    return this.transaction(() => {
      id.parse(removalId)
      const target = this.node(nodeId)
      if (!target.parentId) throw new Error('根问题不能作为分支移除')
      const nodes = this.all<ResearchNode>('nodes').filter(
        (node) => node.workspaceId === target.workspaceId,
      )
      if (nodes.some((node) => node.removalId === removalId) && target.removalId !== removalId)
        throw new Error('此请求编号已用于移除其他分支')
      if (target.removalId === removalId)
        return {
          nodeId,
          removalId,
          nodeIds: nodes.filter((node) => node.removalId === removalId).map((node) => node.id),
        }
      if (target.removedAt) throw new Error('此分支已移除')
      if (
        this.db
          .prepare(
            "SELECT 1 FROM node_edits WHERE json_extract(previous, '$.removalId')=? AND json_extract(previous, '$.workspaceId')=? LIMIT 1",
          )
          .get(removalId, target.workspaceId)
      )
        throw new Error('这次移除已撤销，不能重放旧请求')
      const descendants = new Set([nodeId])
      for (let changed = true; changed;) {
        changed = false
        for (const node of nodes)
          if (node.parentId && descendants.has(node.parentId) && !descendants.has(node.id)) {
            descendants.add(node.id)
            changed = true
          }
      }
      if (
        this.all<ResearchRun>('runs').some(
          (run) => descendants.has(run.nodeId) && run.status === 'running',
        )
      )
        throw new Error('此分支中仍有回复或报告正在生成，请先停止')
      const now = new Date().toISOString(),
        removed = nodes.filter((node) => descendants.has(node.id) && !node.removedAt)
      for (const node of removed) {
        this.db
          .prepare('INSERT INTO node_edits (node_id,previous,created_at) VALUES (?,?,?)')
          .run(node.id, JSON.stringify(node), now)
        this.updateNode({ ...node, removedAt: now, removalId, updatedAt: now })
      }
      return { nodeId, removalId, nodeIds: removed.map((node) => node.id) }
    })
  }
  restoreBranch(nodeId: string, removalId: string) {
    return this.transaction(() => {
      const target = this.node(nodeId)
      if (!target.removedAt) return
      if (target.removalId !== removalId) throw new Error('此分支的移除状态已改变，请刷新后重试')
      if (target.parentId && this.node(target.parentId).removedAt) throw new Error('请先恢复父分支')
      const now = new Date().toISOString()
      for (const node of this.all<ResearchNode>('nodes').filter(
        (node) => node.workspaceId === target.workspaceId && node.removalId === removalId,
      )) {
        this.db
          .prepare('INSERT INTO node_edits (node_id,previous,created_at) VALUES (?,?,?)')
          .run(node.id, JSON.stringify(node), now)
        this.updateNode({ ...node, removedAt: undefined, removalId: undefined, updatedAt: now })
      }
    })
  }
  saveView(workspaceId: string, view: ViewState) {
    const previous = this.db
      .prepare('SELECT payload FROM views WHERE workspace_id=?')
      .get(workspaceId) as { payload: string } | undefined
    if (
      previous &&
      (view.revision ?? 0) < ((JSON.parse(previous.payload) as ViewState).revision ?? 0)
    )
      return
    const parsed = viewSchema.parse(view),
      nodes = this.all<ResearchNode>('nodes').filter((n) => n.workspaceId === workspaceId),
      ids = new Set(nodes.map((n) => n.id)),
      byId = new Map(nodes.map((node) => [node.id, node]))
    const inScope = (nodeId: string, scope?: string) => {
      if (!scope) return true
      const visited = new Set<string>()
      let cursor = byId.get(nodeId)
      while (cursor && !visited.has(cursor.id)) {
        if (cursor.id === scope) return true
        visited.add(cursor.id)
        cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
      }
      return false
    }
    if (!ids.has(parsed.selectedId)) throw new Error('焦点不属于当前研究空间')
    const clean = {
      ...parsed,
      collapsed: parsed.collapsed.filter((id) => ids.has(id)),
      drafts: Object.fromEntries(Object.entries(parsed.drafts).filter(([id]) => ids.has(id))),
      ...(parsed.readers
        ? {
            readers: Object.fromEntries(
              Object.entries(parsed.readers).filter(([id]) => ids.has(id)),
            ),
          }
        : {}),
      ...(parsed.chatDrafts
        ? {
            chatDrafts: Object.fromEntries(
              Object.entries(parsed.chatDrafts).filter(([id]) => ids.has(id)),
            ),
          }
        : {}),
      ...(parsed.graph
        ? {
            graph: {
              ...parsed.graph,
              ...(parsed.graph.noticedNodeIds
                ? {
                    noticedNodeIds: [...new Set(parsed.graph.noticedNodeIds)].filter((id) =>
                      ids.has(id),
                    ),
                  }
                : {}),
              ...(parsed.graph.branchSides
                ? {
                    branchSides: Object.fromEntries(
                      Object.entries(parsed.graph.branchSides).filter(([id]) => ids.has(id)),
                    ),
                  }
                : {}),
              focusId:
                parsed.graph.focusId && inScope(parsed.selectedId, parsed.graph.focusId)
                  ? parsed.graph.focusId
                  : undefined,
              history: parsed.graph.history
                ?.filter(
                  (frame) => ids.has(frame.selectedId) && inScope(frame.selectedId, frame.focusId),
                )
                .map((frame) => ({
                  ...frame,
                  ...(frame.collapsed
                    ? { collapsed: frame.collapsed.filter((id) => ids.has(id)) }
                    : {}),
                })),
              scenes: parsed.graph.scenes
                ?.filter((scene) => !scene.focusId || ids.has(scene.focusId))
                .map((scene) => ({
                  ...scene,
                  ...(scene.positions
                    ? {
                        positions: Object.fromEntries(
                          Object.entries(scene.positions).filter(([id]) => ids.has(id)),
                        ),
                      }
                    : {}),
                })),
            },
          }
        : {}),
    }
    this.db
      .prepare('INSERT OR REPLACE INTO views VALUES (?,?)')
      .run(workspaceId, JSON.stringify(clean))
    this.bump()
  }
  saveRun(run: ResearchRun) {
    // A savepoint keeps a chat turn and its visible messages atomic, including during import.
    this.db.exec('SAVEPOINT save_run')
    try {
      const previous = this.db.prepare('SELECT payload FROM runs WHERE id=?').get(run.id) as
        { payload: string } | undefined
      this.db
        .prepare(
          'INSERT INTO runs VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
        )
        .run(run.id, run.workspaceId, run.nodeId, JSON.stringify(run))
      if (run.mode === 'chat') {
        const make = (role: ConversationMessage['role'], content: string): ConversationMessage => ({
          id: `${run.id}-${role}`,
          workspaceId: run.workspaceId,
          nodeId: run.nodeId,
          runId: run.id,
          role,
          content,
          createdAt: run.createdAt,
        })
        for (const message of [make('user', run.instruction), make('assistant', '')])
          this.db
            .prepare('INSERT OR IGNORE INTO messages VALUES (?,?,?,?,?,?)')
            .run(
              message.id,
              message.workspaceId,
              message.nodeId,
              message.runId,
              message.role,
              JSON.stringify(message),
            )
        if (
          run.status !== 'running' &&
          (!previous || (JSON.parse(previous.payload) as ResearchRun).status === 'running')
        ) {
          const message = make('assistant', run.output)
          this.db
            .prepare('UPDATE messages SET payload=? WHERE id=?')
            .run(JSON.stringify(message), message.id)
        }
      }
      this.bump()
      this.db.exec('RELEASE save_run')
    } catch (error) {
      this.db.exec('ROLLBACK TO save_run; RELEASE save_run')
      throw error
    }
  }
  run(id: string): ResearchRun {
    const row = this.db.prepare('SELECT payload FROM runs WHERE id=?').get(id) as
      { payload: string } | undefined
    if (!row) throw new Error('研究记录不存在')
    return JSON.parse(row.payload)
  }
  complete(runId: string, output: ResearchOutput, sources?: Source[]) {
    return this.transaction(() => {
      const run = this.run(runId)
      if (run.status === 'completed' && run.reportId) return run.reportId
      if (run.status !== 'running') throw new Error('此研究已结束，不能再次写入结果')
      if (run.mode === 'chat') throw new Error('对话不会直接成为报告，请另行整理研究报告')
      const result = this.persistResearch(
        run,
        ResearchOutputSchema.parse(output),
        sources ?? run.context.sources,
        `report:${runId}`,
      )
      this.saveRun({
        ...run,
        status: 'completed',
        phase: '研究完成',
        finishedAt: new Date().toISOString(),
        reportId: result.reportId,
      })
      return result.reportId
    })
  }
  /** An explicit chat tool saves an immutable report and its requested directions together. */
  saveResearch(runId: string, requestId: string, input: ResearchOutput) {
    return this.transaction(() => {
      const run = this.run(runId)
      if (run.status !== 'running' || run.mode !== 'chat')
        throw new Error('请通过当前节点的对话保存研究成果')
      if (this.node(run.nodeId).removedAt) throw new Error('当前分支已移除')
      const key = z.string().trim().min(1).max(200).parse(requestId)
      const output = ResearchOutputSchema.parse(input)
      const fingerprint = createHash('sha256').update(JSON.stringify(output)).digest('hex')
      const previous = this.all<Report>('reports').find(
        (report) => report.workspaceId === run.workspaceId && report.saveRequest?.id === key,
      )
      const branchKey = `report-save:${createHash('sha256').update(key).digest('hex')}`
      if (previous) {
        if (previous.nodeId !== run.nodeId || previous.saveRequest!.fingerprint !== fingerprint)
          throw new Error('此保存请求编号已用于其他内容')
        const nodeIds = output.followups.length
          ? this.deriveBranches({
              parentId: run.nodeId,
              sourceReportId: previous.id,
              requestId: branchKey,
              branches: output.followups,
            }).nodeIds
          : []
        return { reportId: previous.id, nodeIds }
      }
      const sources = [...run.context.sources]
      for (const [, title, url] of output.report.matchAll(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      )) {
        if (sources.some((source) => source.url === url)) continue
        sources.push(
          SourceSchema.parse({
            id: randomUUID(),
            title,
            url,
            excerpt: 'AI 提供的引用；QB 未独立核验。',
          }),
        )
      }
      return this.persistResearch(run, output, sources, branchKey, { id: key, fingerprint })
    })
  }
  /** Caller owns the transaction, including the model tool result receipt. */
  private persistResearch(
    run: ResearchRun,
    output: ResearchOutput,
    sources: Source[],
    branchKey: string,
    saveRequest?: Report['saveRequest'],
  ) {
    const node = this.node(run.nodeId),
      now = new Date().toISOString(),
      reportId = randomUUID()
    const report: Report = {
      id: reportId,
      workspaceId: run.workspaceId,
      nodeId: node.id,
      title: output.title,
      markdown: output.report,
      summary: output.summary,
      findings: output.findings,
      openQuestions: output.openQuestions,
      sources: z.array(SourceSchema).max(100).parse(sources),
      createdAt: now,
      origin: 'ai',
      model: run.model,
      runId: run.id,
      ...(saveRequest ? { saveRequest } : {}),
    }
    this.insertReport(report)
    this.updateNode({
      ...node,
      summary: output.summary,
      openQuestions: output.openQuestions,
      updatedAt: now,
    })
    const nodeIds = output.followups.length
      ? this.deriveBranches({
          parentId: node.id,
          sourceReportId: reportId,
          requestId: branchKey,
          branches: output.followups,
        }).nodeIds
      : []
    return { reportId, nodeIds }
  }
  exportWorkspace(workspaceId: string) {
    const s = this.snapshot(),
      workspace = s.workspaces.find((w) => w.id === workspaceId)
    if (!workspace) throw new Error('研究空间不存在')
    const edits = (
      this.db
        .prepare(
          'SELECT node_id,previous,created_at FROM node_edits WHERE node_id IN (SELECT id FROM nodes WHERE workspace_id=?) ORDER BY id',
        )
        .all(workspaceId) as { node_id: string; previous: string; created_at: string }[]
    ).map((row) => ({
      nodeId: row.node_id,
      previous: JSON.parse(row.previous),
      createdAt: row.created_at,
    }))
    return {
      schemaVersion: 3,
      modelSessions: this.sessions.export(workspaceId),
      workspace,
      nodes: s.nodes.filter((n) => n.workspaceId === workspaceId),
      reports: s.reports.filter((r) => r.workspaceId === workspaceId),
      runs: s.runs.filter((r) => r.workspaceId === workspaceId),
      messages: s.messages.filter((m) => m.workspaceId === workspaceId),
      edits,
      branchRequests: (
        this.db
          .prepare('SELECT payload FROM branch_requests WHERE workspace_id=? ORDER BY rowid')
          .all(workspaceId) as { payload: string }[]
      ).map((row) => JSON.parse(row.payload) as BranchReceipt),
      view: s.views[workspaceId],
    }
  }
  importWorkspace(data: unknown) {
    const parsed = exportSchema.parse(data),
      { workspace, nodes, reports, runs, messages } = parsed
    const ids = new Set(nodes.map((n) => n.id)),
      reportIds = new Set(reports.map((r) => r.id)),
      runIds = new Set(runs.map((r) => r.id))
    if (
      ids.size !== nodes.length ||
      reportIds.size !== reports.length ||
      runIds.size !== runs.length
    )
      throw new Error('导入文件包含重复的记录编号')
    const root = nodes.find((n) => n.id === workspace.rootId)
    if (
      !root ||
      root.removedAt ||
      root.parentId !== null ||
      nodes.filter((n) => n.parentId === null).length !== 1
    )
      throw new Error('导入文件的根研究结构无效')
    const sorted: ResearchNode[] = [],
      remaining = [...nodes],
      seen = new Set<string>()
    while (remaining.length) {
      const i = remaining.findIndex((n) => n.parentId === null || seen.has(n.parentId))
      if (i < 0) throw new Error('导入研究存在循环或缺失父节点')
      const [n] = remaining.splice(i, 1)
      if (
        n.workspaceId !== workspace.id ||
        !!n.removedAt !== !!n.removalId ||
        (n.parentId &&
          nodes.find((parent) => parent.id === n.parentId)?.removedAt &&
          !n.removedAt) ||
        n.relatedIds.some((r) => !ids.has(r)) ||
        (n.originReportId &&
          !reports.some(
            (r) =>
              r.id === n.originReportId &&
              r.nodeId === n.parentId &&
              r.workspaceId === n.workspaceId,
          )) ||
        n.referenceReportIds?.some((id) => !reportIds.has(id))
      )
        throw new Error('导入节点存在无效引用')
      seen.add(n.id)
      sorted.push(n)
    }
    if (
      new Set(reports.filter((r) => r.saveRequest).map((r) => r.saveRequest!.id)).size !==
      reports.filter((r) => r.saveRequest).length
    )
      throw new Error('导入报告包含重复的保存请求编号')
    for (const r of reports)
      if (
        r.workspaceId !== workspace.id ||
        !ids.has(r.nodeId) ||
        (r.runId && !runs.some((run) => run.id === r.runId && run.nodeId === r.nodeId))
      )
        throw new Error('导入报告存在无效引用')
    if (
      new Set(parsed.branchRequests.map((r) => r.requestId)).size !== parsed.branchRequests.length
    )
      throw new Error('导入文件包含重复的创建请求编号')
    for (const receipt of parsed.branchRequests) {
      if (
        receipt.workspaceId !== workspace.id ||
        !reports.some((r) => r.id === receipt.sourceReportId && r.nodeId === receipt.parentId) ||
        receipt.nodeIds.some(
          (id) =>
            !nodes.some(
              (node) =>
                node.id === id &&
                node.parentId === receipt.parentId &&
                node.originReportId === receipt.sourceReportId,
            ),
        )
      )
        throw new Error('导入创建请求存在无效来源')
    }
    for (const r of runs)
      if (
        r.workspaceId !== workspace.id ||
        !ids.has(r.nodeId) ||
        (r.reportId && !reportIds.has(r.reportId)) ||
        (r.selectedReportId &&
          !reports.some(
            (report) => report.id === r.selectedReportId && report.nodeId === r.nodeId,
          )) ||
        r.context.workspaceId !== workspace.id ||
        r.context.nodeId !== r.nodeId ||
        r.context.items.some((i) => !reportIds.has(i.reportId) || !ids.has(i.nodeId)) ||
        r.context.path.some((n) => !ids.has(n))
      )
        throw new Error('导入研究记录存在无效引用')
    for (const edit of parsed.edits)
      if (
        !ids.has(edit.nodeId) ||
        edit.previous.id !== edit.nodeId ||
        edit.previous.workspaceId !== workspace.id
      )
        throw new Error('问题修订记录无效')
    const messageIds = new Set(messages.map((message) => message.id))
    const messageRoles = new Set(messages.map((message) => `${message.runId}:${message.role}`))
    if (messageIds.size !== messages.length || messageRoles.size !== messages.length)
      throw new Error('导入对话包含重复的消息编号或角色')
    for (const message of messages) {
      const run = runs.find((run) => run.id === message.runId)
      if (
        !run ||
        run.mode !== 'chat' ||
        message.workspaceId !== workspace.id ||
        message.nodeId !== run.nodeId
      )
        throw new Error('导入对话存在无效归属')
    }
    for (const run of runs) {
      if (
        run.mode === 'chat' &&
        (run.reportId ||
          !messageRoles.has(`${run.id}:user`) ||
          !messageRoles.has(`${run.id}:assistant`))
      )
        throw new Error('导入对话记录不完整')
      for (const messageId of [
        ...(run.context.conversation?.includedMessageIds ?? []),
        ...(run.context.conversation?.omittedMessageIds ?? []),
      ])
        if (!messages.some((message) => message.id === messageId && message.nodeId === run.nodeId))
          throw new Error('导入上下文引用了无效对话')
    }
    const existing = this.snapshot()
    if (
      existing.workspaces.some((w) => w.id === workspace.id) ||
      existing.nodes.some((n) => ids.has(n.id)) ||
      existing.reports.some((r) => reportIds.has(r.id)) ||
      existing.runs.some((r) => runIds.has(r.id)) ||
      existing.messages.some((message) => messageIds.has(message.id))
    )
      throw new Error('该研究已存在；导入不会覆盖已有资料。可在另一数据目录恢复。')
    this.transaction(() => {
      this.insertWorkspace(workspace)
      const sessionArchive = parsed.modelSessions as
        { sessions?: unknown[]; archives?: unknown[] } | undefined
      if (sessionArchive?.sessions?.length || sessionArchive?.archives?.length)
        this.sessions.archive(workspace.id, sessionArchive)
      sorted.forEach((n) => this.insertNode(n))
      reports.forEach((r) => this.insertReport(r))
      for (const receipt of parsed.branchRequests)
        this.db
          .prepare('INSERT INTO branch_requests VALUES (?,?,?)')
          .run(workspace.id, receipt.requestId, JSON.stringify(receipt))
      runs.forEach((r) =>
        this.saveRun(
          r.status === 'running'
            ? {
                ...r,
                status: 'interrupted',
                phase: '从导出文件恢复，研究未继续运行',
                finishedAt: new Date().toISOString(),
              }
            : r,
        ),
      )
      // Restore the exact original messages after the run lifecycle has been normalized.
      for (const message of messages) {
        this.db
          .prepare('DELETE FROM messages WHERE run_id=? AND role=?')
          .run(message.runId, message.role)
        this.db
          .prepare('INSERT INTO messages VALUES (?,?,?,?,?,?)')
          .run(
            message.id,
            message.workspaceId,
            message.nodeId,
            message.runId,
            message.role,
            JSON.stringify(message),
          )
      }
      parsed.edits.forEach((edit) =>
        this.db
          .prepare('INSERT INTO node_edits (node_id,previous,created_at) VALUES (?,?,?)')
          .run(edit.nodeId, JSON.stringify(edit.previous), edit.createdAt),
      )
      this.saveView(
        workspace.id,
        parsed.view ?? { selectedId: workspace.rootId, collapsed: [], drafts: {} },
      )
    })
    return workspace.id
  }
  close() {
    this.db.close()
  }
}

function localCodec(directory: string): CredentialCodec {
  const path = join(directory, '.credential-key')
  if (!existsSync(path)) writeFileSync(path, randomBytes(32), { mode: 0o600 })
  const key = readFileSync(path)
  return {
    encrypt(value) {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv),
        body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
    },
    decrypt(value) {
      const buffer = Buffer.from(value, 'base64'),
        decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12))
      decipher.setAuthTag(buffer.subarray(12, 28))
      return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString(
        'utf8',
      )
    },
  }
}
