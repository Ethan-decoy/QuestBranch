import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
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
  SourceSchema,
} from '../research/types'
import { starterResearch } from '../research/seed'

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
  title: text,
  question: text,
  summary: text,
  openQuestions: z.array(text).max(100),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  relatedIds: z.array(id).max(100),
  createdAt: time,
  updatedAt: time,
  originReportId: id.optional(),
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
  id,
  workspaceId: id,
  nodeId: id,
  instruction: text,
  status: z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted']),
  phase: text,
  output: z.string().max(180000),
  error: text,
  model: text,
  context: contextSchema,
  createdAt: time,
  finishedAt: time.optional(),
  reportId: id.optional(),
  mode: z.literal('chat').optional(),
  provider: z.enum(['compatible', 'ollama', 'codex']).optional(),
  codex: z.object({ threadId: id, turnId: id.optional() }).optional(),
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
export const viewSchema = z.object({
  revision: z.number().nonnegative().optional(),
  selectedId: id,
  collapsed: z.array(id).max(5000),
  drafts: z.record(id, z.string().max(12000)),
  chatDrafts: z.record(id, z.string().max(12000)).optional(),
  viewport: z
    .object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().min(0.05).max(5) })
    .optional(),
  positions: z.record(id, z.object({ x: z.number().finite(), y: z.number().finite() })).optional(),
})
const editSchema = z.object({ nodeId: id, previous: nodeSchema, createdAt: time })
const exportSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  workspace: workspaceSchema,
  nodes: z.array(nodeSchema).min(1).max(10000),
  reports: z.array(reportSchema).max(20000),
  runs: z.array(runSchema).max(20000),
  messages: z.array(messageSchema).max(40000).default([]),
  edits: z.array(editSchema).max(50000).default([]),
  view: viewSchema.optional(),
})

export class ResearchStore {
  private db: DatabaseSync
  private codec: CredentialCodec
  constructor(
    readonly directory: string,
    options: { seed?: boolean; codec?: CredentialCodec; recoverRuns?: boolean } = {},
  ) {
    mkdirSync(directory, { recursive: true })
    this.codec = options.codec ?? localCodec(directory)
    this.db = new DatabaseSync(join(directory, 'research.sqlite'))
    if (Number(this.db.prepare('PRAGMA user_version').get()!.user_version) > 2) {
      this.db.close()
      throw new Error('数据库由较新的问枝版本创建，请使用对应版本打开')
    }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      INSERT OR IGNORE INTO meta VALUES ('version',0);
      CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), parent_id TEXT REFERENCES nodes(id), payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS nodes_workspace ON nodes(workspace_id);
      CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), node_id TEXT NOT NULL REFERENCES nodes(id), payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS reports_node ON reports(node_id);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), node_id TEXT NOT NULL REFERENCES nodes(id), payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS views (workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS node_edits (id INTEGER PRIMARY KEY, node_id TEXT NOT NULL REFERENCES nodes(id), previous TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), node_id TEXT NOT NULL REFERENCES nodes(id), run_id TEXT NOT NULL REFERENCES runs(id), role TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(run_id,role));
      CREATE INDEX IF NOT EXISTS messages_node ON messages(node_id);
      PRAGMA user_version=2;`)
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
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.bump()
      this.db.exec('COMMIT')
      return result
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
  snapshot(): Snapshot {
    const views = Object.fromEntries(
      (
        this.db.prepare('SELECT workspace_id,payload FROM views').all() as {
          workspace_id: string
          payload: string
        }[]
      ).map((row) => [row.workspace_id, JSON.parse(row.payload)]),
    )
    return {
      version: Number(this.db.prepare("SELECT value FROM meta WHERE key='version'").get()!.value),
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
  settings(): Settings {
    const saved = this.readSetting('preferences')
    const settings: Settings = {
      ...defaultSettings,
      ...(process.env.OPENAI_BASE_URL ? { baseUrl: process.env.OPENAI_BASE_URL } : {}),
      ...(process.env.OPENAI_MODEL ? { model: process.env.OPENAI_MODEL } : {}),
      ...(saved ? JSON.parse(saved) : {}),
    }
    const apiOrigin = this.readSetting('apiKeyOrigin'),
      envOrigin = (process.env.OPENAI_BASE_URL ?? defaultSettings.baseUrl).replace(/\/+$/, '')
    return {
      ...settings,
      hasApiKey: !!(
        (this.readSetting('apiKey') && apiOrigin === settings.baseUrl) ||
        (process.env.OPENAI_API_KEY &&
          settings.provider === 'compatible' &&
          envOrigin === settings.baseUrl)
      ),
      hasSearchKey: !!(this.readSetting('searchKey') || process.env.TAVILY_API_KEY),
    }
  }
  credentials(): { apiKey: string; searchKey: string } {
    const read = (name: string, fallback?: string) => {
      const encrypted = this.readSetting(name)
      return encrypted ? this.codec.decrypt(encrypted) : (fallback ?? '')
    }
    const settings = this.settings(),
      local = this.readSetting('apiKeyOrigin') === settings.baseUrl
    return {
      apiKey: settings.hasApiKey
        ? local
          ? read('apiKey', process.env.OPENAI_API_KEY)
          : (process.env.OPENAI_API_KEY ?? '')
        : '',
      searchKey: read('searchKey', process.env.TAVILY_API_KEY),
    }
  }
  saveSettings(input: SettingsInput) {
    const url = new URL(input.baseUrl)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('服务地址应为不含密钥、查询参数或片段的 HTTP / HTTPS 地址')
    const preferences = {
      provider: input.provider,
      baseUrl: input.baseUrl.replace(/\/+$/, ''),
      model: input.model.trim(),
      jsonMode: input.jsonMode,
      contextBudget: input.contextBudget,
      codexPath: input.codexPath?.trim() ?? '',
    }
    this.transaction(() => {
      this.putSetting('preferences', JSON.stringify(preferences))
      for (const name of ['apiKey', 'searchKey'] as const) {
        const clear = name === 'apiKey' ? input.clearApiKey : input.clearSearchKey
        if (clear) this.db.prepare('DELETE FROM settings WHERE key=?').run(name)
        else if (input[name]?.trim()) {
          this.putSetting(name, this.codec.encrypt(input[name]!.trim()))
          if (name === 'apiKey') this.putSetting('apiKeyOrigin', preferences.baseUrl)
        }
      }
    })
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
  createNode(parentId: string, question: string, relatedIds: string[] = []) {
    const parent = this.node(parentId),
      now = new Date().toISOString(),
      nid = randomUUID()
    if (relatedIds.some((id) => this.node(id).workspaceId !== parent.workspaceId))
      throw new Error('相关研究必须属于当前研究空间')
    const siblings = this.all<ResearchNode>('nodes').filter((n) => n.parentId === parentId)
    this.transaction(() =>
      this.insertNode({
        id: nid,
        workspaceId: parent.workspaceId,
        parentId,
        title: question.slice(0, 80),
        question,
        summary: '',
        openQuestions: [],
        relatedIds: [...new Set(relatedIds)],
        color: parent.parentId === null ? palette[siblings.length % palette.length] : parent.color,
        createdAt: now,
        updatedAt: now,
      }),
    )
    return nid
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
      ids = new Set(nodes.map((n) => n.id))
    if (!ids.has(parsed.selectedId)) throw new Error('焦点不属于当前研究空间')
    const clean = {
      ...parsed,
      collapsed: parsed.collapsed.filter((id) => ids.has(id)),
      drafts: Object.fromEntries(Object.entries(parsed.drafts).filter(([id]) => ids.has(id))),
      ...(parsed.chatDrafts
        ? {
            chatDrafts: Object.fromEntries(
              Object.entries(parsed.chatDrafts).filter(([id]) => ids.has(id)),
            ),
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
  complete(runId: string, output: ResearchOutput) {
    return this.transaction(() => {
      const run = this.run(runId)
      if (run.status !== 'running') throw new Error('此研究已结束，不能再次写入结果')
      if (run.mode === 'chat') throw new Error('对话不会直接成为报告，请另行整理研究报告')
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
        sources: run.context.sources,
        createdAt: now,
        origin: 'ai',
        model: run.model,
        runId,
      }
      this.insertReport(report)
      this.updateNode({
        ...node,
        summary: output.summary,
        openQuestions: output.openQuestions,
        updatedAt: now,
      })
      const existing = this.all<ResearchNode>('nodes').filter((n) => n.parentId === node.id)
      for (const next of output.followups) {
        if (
          existing.some(
            (n) =>
              n.question.trim() === next.question.trim() || n.title.trim() === next.title.trim(),
          )
        )
          continue
        const child: ResearchNode = {
          id: randomUUID(),
          workspaceId: node.workspaceId,
          parentId: node.id,
          title: next.title,
          question: next.question,
          summary: '',
          openQuestions: [],
          relatedIds: [],
          color: node.color,
          createdAt: now,
          updatedAt: now,
          originReportId: reportId,
        }
        this.insertNode(child)
        existing.push(child)
      }
      this.saveRun({ ...run, status: 'completed', phase: '研究完成', finishedAt: now, reportId })
      return reportId
    })
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
      schemaVersion: 2,
      workspace,
      nodes: s.nodes.filter((n) => n.workspaceId === workspaceId),
      reports: s.reports.filter((r) => r.workspaceId === workspaceId),
      runs: s.runs.filter((r) => r.workspaceId === workspaceId),
      messages: s.messages.filter((m) => m.workspaceId === workspaceId),
      edits,
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
    if (!root || root.parentId !== null || nodes.filter((n) => n.parentId === null).length !== 1)
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
        n.relatedIds.some((r) => !ids.has(r)) ||
        (n.originReportId && !reportIds.has(n.originReportId))
      )
        throw new Error('导入节点存在无效引用')
      seen.add(n.id)
      sorted.push(n)
    }
    for (const r of reports)
      if (r.workspaceId !== workspace.id || !ids.has(r.nodeId) || (r.runId && !runIds.has(r.runId)))
        throw new Error('导入报告存在无效引用')
    for (const r of runs)
      if (
        r.workspaceId !== workspace.id ||
        !ids.has(r.nodeId) ||
        (r.reportId && !reportIds.has(r.reportId)) ||
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
      sorted.forEach((n) => this.insertNode(n))
      reports.forEach((r) => this.insertReport(r))
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
