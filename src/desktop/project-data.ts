import { randomUUID } from 'node:crypto'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { z } from 'zod'
import type { ResearchProject, ResearchNavigation } from '../research/projects'

export const projectSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(100),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  lastWorkspaceId: z.string().optional(),
})
export type TransferMark = {
  id: string
  workspaceId: string
  direction: 'in' | 'out'
  state: 'pending' | 'done'
}
const tables = [
  'workspaces',
  'nodes',
  'reports',
  'runs',
  'messages',
  'views',
  'node_edits',
  'branch_requests',
  'model_sessions',
  'model_tool_results',
  'model_session_archives',
  'acp_sessions',
  'workspace_navigation',
] as const
export type WorkspaceRows = Record<(typeof tables)[number], Record<string, SQLInputValue>[]>

/** Project metadata and lossless SQL transfers; never round-trip writable sessions through JSON imports. */
export class ProjectData {
  constructor(
    private readonly db: DatabaseSync,
    private readonly transaction: <T>(work: () => T) => T,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS research_project (singleton INTEGER PRIMARY KEY CHECK(singleton=1),payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspace_navigation (workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_requests (id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_transfers (id TEXT PRIMARY KEY,payload TEXT NOT NULL);`)
  }
  info(): ResearchProject | undefined {
    const row = this.db.prepare('SELECT payload FROM research_project WHERE singleton=1').get()
    return row ? projectSchema.parse(JSON.parse(String(row.payload))) : undefined
  }
  ensure(name: string, id: string = randomUUID()) {
    const existing = this.info()
    if (existing) return existing
    const now = new Date().toISOString()
    return this.update(projectSchema.parse({ id, name, createdAt: now, updatedAt: now }))
  }
  update(project: ResearchProject) {
    const parsed = projectSchema.parse(project)
    this.transaction(() =>
      this.db
        .prepare('INSERT OR REPLACE INTO research_project VALUES (1,?)')
        .run(JSON.stringify(parsed)),
    )
    return parsed
  }
  navigation(): Record<string, ResearchNavigation> {
    return Object.fromEntries(
      this.db
        .prepare('SELECT workspace_id,payload FROM workspace_navigation')
        .all()
        .map((row) => [
          String(row.workspace_id),
          JSON.parse(String(row.payload)) as ResearchNavigation,
        ]),
    )
  }
  preference(workspaceId: string, patch: Partial<ResearchNavigation>) {
    if (!this.db.prepare('SELECT id FROM workspaces WHERE id=?').get(workspaceId))
      throw new Error('研究不存在')
    this.transaction(() =>
      this.db
        .prepare('INSERT OR REPLACE INTO workspace_navigation VALUES (?,?)')
        .run(workspaceId, JSON.stringify({ ...this.navigation()[workspaceId], ...patch })),
    )
  }
  request(id: string): string | undefined {
    const row = this.db.prepare('SELECT payload FROM project_requests WHERE id=?').get(id)
    return row ? String(row.payload) : undefined
  }
  rememberRequest(id: string, workspaceId: string) {
    this.db.prepare('INSERT INTO project_requests VALUES (?,?)').run(id, workspaceId)
  }
  marks(): TransferMark[] {
    return this.db
      .prepare('SELECT payload FROM project_transfers')
      .all()
      .map((row) => JSON.parse(String(row.payload)) as TransferMark)
  }
  mark(mark: TransferMark) {
    this.transaction(() =>
      this.db
        .prepare('INSERT OR REPLACE INTO project_transfers VALUES (?,?)')
        .run(mark.id, JSON.stringify(mark)),
    )
  }
  private where(table: (typeof tables)[number]) {
    if (table === 'workspaces') return 'id=?'
    if (table === 'model_tool_results')
      return 'session_id IN (SELECT session_id FROM model_sessions WHERE workspace_id=?)'
    if (table === 'acp_sessions' || table === 'node_edits')
      return 'node_id IN (SELECT id FROM nodes WHERE workspace_id=?)'
    return 'workspace_id=?'
  }
  rows(workspaceId: string): WorkspaceRows {
    return Object.fromEntries(
      tables.map((table) => [
        table,
        this.db
          .prepare(`SELECT * FROM ${table} WHERE ${this.where(table)} ORDER BY rowid`)
          .all(workspaceId),
      ]),
    ) as WorkspaceRows
  }
  receive(rows: WorkspaceRows, mark: TransferMark) {
    this.transaction(() => {
      this.db.exec('PRAGMA defer_foreign_keys=ON')
      for (const table of tables)
        for (const row of rows[table]) {
          const columns = Object.keys(row).filter((key) => table !== 'node_edits' || key !== 'id')
          const actual = new Set(
            this.db
              .prepare(`PRAGMA table_info(${table})`)
              .all()
              .map((column) => String(column.name)),
          )
          if (columns.some((column) => !actual.has(column))) throw new Error('研究数据版本不兼容')
          this.db
            .prepare(
              `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
            )
            .run(...columns.map((column) => row[column]))
        }
      this.mark(mark)
    })
  }
  remove(workspaceId: string) {
    this.transaction(() => {
      this.db.exec('PRAGMA defer_foreign_keys=ON')
      // Dependent receipts must be removed before the session/node selectors disappear.
      for (const table of [
        'model_tool_results',
        'acp_sessions',
        'node_edits',
        ...tables.filter(
          (t) =>
            !['model_tool_results', 'acp_sessions', 'node_edits', 'nodes', 'workspaces'].includes(
              t,
            ),
        ),
        'nodes',
        'workspaces',
      ] as (typeof tables)[number][])
        this.db.prepare(`DELETE FROM ${table} WHERE ${this.where(table)}`).run(workspaceId)
    })
  }
}
