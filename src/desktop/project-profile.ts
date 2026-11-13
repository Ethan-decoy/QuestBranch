import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { SettingsStore, createLocalCredentialCodec, type CredentialCodec } from './settings-store'
import type { ResearchStore } from './store'
import type { Workspace } from '../research/types'
import type { ResearchProject, ProjectNavigation } from '../research/projects'

export type ProjectRecord = {
  directory: string
  project: ResearchProject
  workspaces: Workspace[]
  legacy?: boolean
  opened?: boolean
  pinned?: boolean
  order?: number
}
export type Transfer = {
  id: string
  workspaceId: string
  source: string
  target: string
  phase: 'prepared' | 'committed' | 'done' | 'cancelled'
}
export class ProjectProfile {
  readonly database: string
  readonly settings: SettingsStore
  private readonly db: DatabaseSync
  constructor(directory: string, codec?: CredentialCodec) {
    mkdirSync(directory, { recursive: true })
    this.database = join(directory, 'application.sqlite')
    this.db = new DatabaseSync(this.database)
    if (Number(this.db.prepare('PRAGMA user_version').get()!.user_version) > 2) {
      this.db.close()
      throw new Error('应用配置由较新的问之版本创建')
    }
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY,directory TEXT NOT NULL UNIQUE,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS profile_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      INSERT OR IGNORE INTO profile_meta VALUES ('version','0'); PRAGMA user_version=2;`)
    this.settings = new SettingsStore(
      this.db,
      codec ?? createLocalCredentialCodec(directory),
      (work) => this.transaction(work),
    )
  }
  private transaction<T>(work: () => T) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.db.exec(
        "UPDATE profile_meta SET value=CAST(value AS INTEGER)+1 WHERE key='version'; COMMIT;",
      )
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  private read(key: string) {
    return this.db.prepare('SELECT value FROM profile_meta WHERE key=?').get(key)?.value as
      string | undefined
  }
  private write(key: string, value: string) {
    this.transaction(() =>
      this.db.prepare('INSERT OR REPLACE INTO profile_meta VALUES (?,?)').run(key, value),
    )
  }
  get version() {
    return Number(this.read('version') ?? 0)
  }
  get activeId() {
    return this.read('active') ?? ''
  }
  activate(id: string) {
    if (id !== this.activeId) this.write('active', id)
  }
  navigation(): ProjectNavigation {
    const saved = JSON.parse(this.read('navigation') ?? '{}') as Partial<ProjectNavigation>
    return { collapsed: saved.collapsed ?? [], recent: saved.recent ?? [] }
  }
  saveNavigation(value: ProjectNavigation) {
    this.write('navigation', JSON.stringify(value))
  }
  importSettings(legacy: ResearchStore) {
    if (this.read('connections-imported')) return
    legacy.copySettingsTo(this.settings)
    this.write('connections-imported', '1')
  }
  projects(): ProjectRecord[] {
    return this.db
      .prepare('SELECT payload FROM projects ORDER BY rowid')
      .all()
      .map((row) => {
        const record = JSON.parse(String(row.payload)) as ProjectRecord & { workspace?: Workspace }
        if (record.project) return record
        const old = record.workspace!
        return {
          ...record,
          project: {
            id: old.id,
            name: old.name,
            createdAt: old.createdAt,
            updatedAt: old.updatedAt,
          },
          workspaces: [old],
        }
      })
  }
  remember(record: ProjectRecord) {
    const directory =
      process.platform === 'win32' ? record.directory.toLowerCase() : record.directory
    const previous = this.projects().find(
      (p) => p.project.id === record.project.id || this.path(p.directory) === directory,
    )
    const merged = {
      ...previous,
      ...record,
      opened: record.opened ?? previous?.opened ?? true,
      order: record.order ?? previous?.order ?? this.projects().length,
    }
    const payload = JSON.stringify(merged)
    if (
      this.db.prepare('SELECT payload FROM projects WHERE id=?').get(record.project.id)?.payload ===
      payload
    )
      return
    this.transaction(() => {
      // v1 indexes stored Windows path casing verbatim. Retire the old identity
      // by ID as well as canonical path when upgrading a one-study project.
      if (
        previous &&
        previous.project.id !== record.project.id &&
        this.path(previous.directory) === directory
      )
        this.db.prepare('DELETE FROM projects WHERE id=?').run(previous.project.id)
      this.db
        .prepare('DELETE FROM projects WHERE directory=? AND id<>?')
        .run(directory, record.project.id)
      this.db
        .prepare(
          'INSERT INTO projects VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET directory=excluded.directory,payload=excluded.payload',
        )
        .run(record.project.id, directory, payload)
    })
  }
  private path(path: string) {
    return process.platform === 'win32' ? path.toLowerCase() : path
  }
  reorder(projectIds: string[]) {
    const records = new Map(this.projects().map((record) => [record.project.id, record]))
    if (new Set(projectIds).size !== projectIds.length || projectIds.some((id) => !records.has(id)))
      throw new Error('项目排序包含无效的项目')
    const updates = projectIds
      .map((id, order) => ({ ...records.get(id)!, order }))
      .filter((record) => records.get(record.project.id)!.order !== record.order)
    if (!updates.length) return
    this.transaction(() => {
      const update = this.db.prepare('UPDATE projects SET payload=? WHERE id=?')
      for (const record of updates) update.run(JSON.stringify(record), record.project.id)
    })
  }
  transfers(): Transfer[] {
    return this.db
      .prepare("SELECT value FROM profile_meta WHERE key LIKE 'transfer:%'")
      .all()
      .map((row) => JSON.parse(String(row.value)) as Transfer)
  }
  transfer(record: Transfer) {
    this.write('transfer:' + record.id, JSON.stringify(record))
  }
  created(id: string) {
    const value = this.read('created:' + id)
    return value ? (JSON.parse(value) as { projectId: string }) : undefined
  }
  rememberCreated(id: string, projectId: string) {
    this.write('created:' + id, JSON.stringify({ projectId }))
  }
  close() {
    if (this.db.isOpen) this.db.close()
  }
}
