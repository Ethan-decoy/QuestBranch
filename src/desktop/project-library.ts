import { randomUUID, createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ResearchStore, type CredentialCodec } from './store'
import { ResearchService } from './service'
import { ProjectProfile, type ProjectRecord, type Transfer } from './project-profile'
import {
  copyProject,
  inspectProject,
  projectData,
  projectFolder,
  relocationFolder,
  projectStoreOptions,
  writeProject,
} from './project-files'
import { commandSchema, id } from './command-schemas'
import { projectCommandSchema } from './project-commands'
import { exportSchema } from './storage-schemas'
import type { AppCommand, ResearchClient, SettingsInput, Snapshot } from '../research/types'
import type { ProjectCommand, ProjectResult, ResearchProject } from '../research/projects'

type Slot = { store: ResearchStore; service: ResearchService; directory: string; legacy?: boolean }
type Options = {
  codec?: CredentialCodec
  service?: (store: ResearchStore) => ResearchService
  fault?: (phase: 'prepared' | 'copied' | 'committed' | 'cleaned') => void
}
/** All callers use identities, never the current selection, to address background work. */
export class ProjectLibrary implements ResearchClient {
  private readonly profile: ProjectProfile
  private readonly slots = new Map<string, Slot>()
  private readonly snapshots = new WeakMap<Slot, Snapshot>()
  private readonly authOwners = new Map<string, Slot>()
  private readonly blocked = new Map<string, string>()
  private activeProjectId = ''
  private activeWorkspaceId = ''
  private revision = 0
  private fingerprint = ''
  private changing = false
  constructor(
    readonly legacyDirectory: string,
    profileDirectory: string,
    private readonly options: Options = {},
  ) {
    this.profile = new ProjectProfile(profileDirectory, options.codec)
    try {
      // Close/reopen metadata is persistent; a closed compatibility library must stay closed.
      const registeredLegacy = this.profile.created('legacy')
      const legacyRecord = this.profile
        .projects()
        .find((p) => p.project.id === registeredLegacy?.projectId)
      if (!registeredLegacy || (legacyRecord?.legacy && legacyRecord.opened !== false)) {
        const original = new ResearchStore(legacyDirectory, { codec: options.codec })
        try {
          this.profile.importSettings(original)
        } finally {
          original.close()
        }
        const legacy = this.makeSlot(legacyDirectory, legacyDirectory, true)
        const project = legacy.store.projectData.ensure('已有研究')
        this.slots.set(project.id, legacy)
        this.remember(legacy)
        this.profile.rememberCreated('legacy', project.id)
      }
      for (const entry of this.profile.projects().filter((p) => !p.legacy && p.opened !== false)) {
        let slot: Slot | undefined
        try {
          inspectProject(entry.directory)
          slot = this.makeSlot(projectData(entry.directory), entry.directory)
          const project = slot.store.projectData.ensure(entry.project.name)
          if (!slot.store.projectData.marks().some((mark) => mark.state === 'pending'))
            this.validate(slot)
          this.slots.set(project.id, slot)
          this.remember(slot)
        } catch (error) {
          slot?.service.shutdown()
          slot?.store.close()
          this.blocked.set(entry.project.id, error instanceof Error ? error.message : String(error))
        }
      }
      this.recoverTransfers()
      const saved = this.profile.activeId
      this.activeProjectId =
        this.records().find((p) => p.project.id === saved)?.project.id ??
        this.records().find((p) => p.workspaces.some((w) => w.id === saved))?.project.id ??
        this.records()[0]?.project.id ??
        ''
      this.chooseWorkspace()
    } catch (error) {
      this.shutdown()
      throw error
    }
  }
  private makeSlot(databaseDirectory: string, root: string, legacy = false): Slot {
    const store = new ResearchStore(databaseDirectory, {
      settingsStore: this.profile.settings,
      credentialDatabase: this.profile.database,
      ...(!legacy ? projectStoreOptions(this.profile, root) : {}),
    })
    try {
      return {
        store,
        service: this.options.service?.(store) ?? new ResearchService(store),
        directory: root,
        legacy,
      }
    } catch (error) {
      store.close()
      throw error
    }
  }
  private records() {
    return this.profile
      .projects()
      .filter((p) => p.opened !== false)
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (a.order ?? 0) - (b.order ?? 0))
  }
  private read(slot: Slot) {
    const before = this.snapshots.get(slot),
      value = before ? (slot.store.snapshot(before.version) ?? before) : slot.store.snapshot()
    this.snapshots.set(slot, value)
    if (!slot.legacy) return value
    // The old shared database is also the recovery copy for already-extracted projects.
    const extracted = new Set(
      this.profile
        .projects()
        .filter((p) => !p.legacy)
        .flatMap((p) => p.workspaces.map((w) => w.id)),
    )
    const keep = (workspaceId: string) => !extracted.has(workspaceId)
    return {
      ...value,
      workspaces: value.workspaces.filter((w) => keep(w.id)),
      nodes: value.nodes.filter((n) => keep(n.workspaceId)),
      reports: value.reports.filter((n) => keep(n.workspaceId)),
      runs: value.runs.filter((n) => keep(n.workspaceId)),
      messages: value.messages.filter((n) => keep(n.workspaceId)),
      views: Object.fromEntries(Object.entries(value.views).filter(([key]) => keep(key))),
    }
  }
  private info(slot: Slot): ResearchProject {
    return slot.store.projectData.info()!
  }
  private remember(slot: Slot, patch: Partial<ProjectRecord> = {}) {
    this.profile.remember({
      directory: slot.directory,
      project: this.info(slot),
      workspaces: this.read(slot).workspaces,
      legacy: slot.legacy,
      ...patch,
    })
  }
  private available(projectId: string) {
    const slot = this.slots.get(projectId)
    return (
      !!slot &&
      !this.blocked.has(projectId) &&
      existsSync(join(slot.store.directory, 'research.sqlite'))
    )
  }
  private slot(projectId: string) {
    const slot = this.slots.get(id.parse(projectId))
    if (!slot || !this.available(projectId))
      throw new Error(this.blocked.get(projectId) ?? '项目文件夹不可用，请重新打开原项目文件夹')
    return slot
  }
  private get current() {
    return this.slot(this.activeProjectId)
  }
  isLegacyDirectory(directory: string) {
    return this.profile.projects().some((p) => p.legacy && p.directory === directory)
  }
  get hasActiveRuns() {
    return this.changing || [...this.slots.values()].some((slot) => slot.service.hasActiveRuns)
  }
  private idle(slot: Slot) {
    if (slot.service.hasActiveRuns) throw new Error('请先结束该项目的研究和账号连接')
  }
  private owner(workspaceId: string) {
    const matches = [...this.slots.entries()].filter(([, slot]) =>
      this.read(slot).workspaces.some((w) => w.id === workspaceId),
    )
    if (matches.length !== 1) throw new Error('研究不存在、归属冲突或项目未打开')
    return this.slot(matches[0][0])
  }
  private recordOwner(recordId: string, kind: 'nodes' | 'runs') {
    const matches = [...this.slots.values()].flatMap((slot) =>
      this.read(slot)[kind].filter((row) => row.id === recordId),
    )
    if (matches.length !== 1) throw new Error('研究记录不存在或标识冲突')
    return this.owner(matches[0].workspaceId)
  }
  private validate(slot: Slot) {
    const own = this.read(slot)
    for (const other of this.slots.values())
      if (other !== slot)
        for (const kind of ['workspaces', 'nodes', 'reports', 'runs', 'messages'] as const) {
          const ids = new Set(this.read(other)[kind].map((row) => row.id))
          if (own[kind].some((row) => ids.has(row.id)))
            throw new Error('研究记录标识冲突，请检查项目副本')
        }
    const workspaces = new Set(own.workspaces.map((w) => w.id))
    if (
      [own.nodes, own.reports, own.runs, own.messages].some((rows) =>
        rows.some((row) => !workspaces.has(row.workspaceId)),
      )
    )
      throw new Error('研究归属关系不完整')
  }
  private chooseWorkspace() {
    const slot = this.slots.get(this.activeProjectId)
    if (!slot) {
      this.activeWorkspaceId = ''
      return
    }
    const navigation = slot.store.projectData.navigation()
    const choices = this.read(slot)
      .workspaces.filter((w) => !navigation[w.id]?.archivedAt)
      .sort((a, b) => (navigation[a.id]?.order ?? 0) - (navigation[b.id]?.order ?? 0))
    const previous = this.info(slot).lastWorkspaceId
    this.activeWorkspaceId = choices.find((w) => w.id === previous)?.id ?? choices[0]?.id ?? ''
  }
  private appendResearch(slot: Slot, workspaceId: string) {
    const navigation = slot.store.projectData.navigation()
    const order =
      Math.max(
        -1,
        ...this.read(slot)
          .workspaces.filter((w) => w.id !== workspaceId)
          .map((w) => navigation[w.id]?.order ?? 0),
      ) + 1
    slot.store.projectData.preference(workspaceId, { order })
  }
  private importResearch(slot: Slot, data: unknown) {
    const parsed = exportSchema.parse(data)
    if (this.profile.projects().some((p) => p.workspaces.some((w) => w.id === parsed.workspace.id)))
      throw new Error('该研究已存在；请打开原项目或使用移动到项目')
    return slot.store.transaction(() => {
      const workspaceId = slot.store.importWorkspace(parsed)
      this.validate(slot)
      this.appendResearch(slot, workspaceId)
      return workspaceId
    })
  }
  private closeProject(projectId: string) {
    const record = this.records().find((p) => p.project.id === projectId)
    if (!record) throw new Error('项目不存在')
    const slot = this.slots.get(projectId)
    if (slot) {
      this.idle(slot)
      if (this.available(projectId)) this.remember(slot, { opened: false })
      else this.profile.remember({ ...record, opened: false })
      slot.service.shutdown()
      slot.store.close()
      this.slots.delete(projectId)
    } else this.profile.remember({ ...record, opened: false })
    this.blocked.delete(projectId)
    if (this.activeProjectId === projectId) {
      this.activeProjectId = this.records()[0]?.project.id ?? ''
      this.profile.activate(this.activeProjectId)
      this.chooseWorkspace()
    }
  }
  private selectProject(projectId: string) {
    if (!this.records().some((p) => p.project.id === projectId)) throw new Error('项目不存在')
    this.activeProjectId = projectId
    this.profile.activate(projectId)
    this.chooseWorkspace()
  }
  activate(workspaceId: string) {
    const slot = this.owner(workspaceId),
      project = this.info(slot)
    this.activeProjectId = project.id
    this.activeWorkspaceId = workspaceId
    this.profile.activate(project.id)
    if (project.lastWorkspaceId !== workspaceId)
      slot.store.projectData.update({ ...project, lastWorkspaceId: workspaceId })
    const navigation = this.profile.navigation()
    this.profile.saveNavigation({
      ...navigation,
      recent: [workspaceId, ...navigation.recent.filter((i) => i !== workspaceId)].slice(0, 100),
    })
  }
  get agent(): NonNullable<ResearchClient['agent']> {
    const owner = (connectionId: string) => {
      id.parse(connectionId)
      const slot = [...this.slots.values()].find((s) => s.service.ownsAgentConnection(connectionId))
      if (!slot) throw new Error('智能体连接已结束')
      return slot.service.agent
    }
    return {
      connect: (config) => this.current.service.agent.connect(config),
      state: (key) => owner(key).state(key),
      authenticate: (key, method) => owner(key).authenticate(key, method),
      configure: (key, config, value) => owner(key).configure(key, config, value),
      respond: (key, request, response) => owner(key).respond(key, request, response),
      disconnect: (key) => owner(key).disconnect(key),
      resetSession: (runId) => this.resetAgentSession(runId),
    }
  }
  get auth(): ResearchClient['auth'] {
    const owner = (key: string) => {
      const slot = this.authOwners.get(id.parse(key))
      if (!slot || !slot.store.isOpen) throw new Error('账号连接已结束')
      return slot.service.auth
    }
    return {
      start: async (input, type) => {
        if (this.hasActiveRuns) throw new Error('请等待研究和连接结束')
        const slot = this.current
        const result = await slot.service.auth.start(input, type)
        this.authOwners.set(result.id, slot)
        return result
      },
      status: (key) => owner(key).status(key),
      respond: (key, prompt, value) => owner(key).respond(key, prompt, value),
      cancel: (key) => owner(key).cancel(key),
      logout: (input) => {
        if (this.hasActiveRuns) throw new Error('请等待研究和连接结束')
        return this.current.service.auth.logout(input)
      },
    }
  }
  modelProviders() {
    return this.current.service.modelProviders()
  }
  testConnection(input?: SettingsInput) {
    return this.current.service.testConnection(input)
  }
  async snapshot(): Promise<Snapshot>
  async snapshot(version: number): Promise<Snapshot | null>
  async snapshot(version?: number): Promise<Snapshot | null> {
    for (const slot of this.slots.values()) this.remember(slot)
    const records = this.records()
    const parts = records
      .filter((entry) => this.available(entry.project.id))
      .map((entry) => ({
        projectId: entry.project.id,
        state: this.read(this.slots.get(entry.project.id)!),
      }))
    const navigation = Object.assign(
      {},
      ...parts.map((p) => p.state.researchNavigation),
    ) as NonNullable<Snapshot['researchNavigation']>
    const workspaces = records.flatMap((entry) => {
      const state = parts.find((p) => p.projectId === entry.project.id)?.state
      return (state?.workspaces ?? entry.workspaces).map((workspace) => ({
        ...workspace,
        projectId: entry.project.id,
      }))
    })
    const projects = records.map((entry) => ({
      ...entry.project,
      directory: entry.directory,
      legacy: entry.legacy,
      pinned: entry.pinned,
      order: entry.order,
      available: this.available(entry.project.id),
      error: this.blocked.get(entry.project.id),
      nodeCount:
        parts.find((p) => p.projectId === entry.project.id)?.state.nodes.filter((n) => !n.removedAt)
          .length ?? 0,
    }))
    const active = records.find((p) => p.project.id === this.activeProjectId)
    const key = JSON.stringify([
      this.activeProjectId,
      this.activeWorkspaceId,
      this.profile.version,
      parts.map((p) => p.state.version),
      projects,
    ])
    if (key !== this.fingerprint) {
      this.fingerprint = key
      this.revision++
    }
    if (version === this.revision) return null
    return {
      version: this.revision,
      activeProjectId: this.activeProjectId,
      activeWorkspaceId: this.activeWorkspaceId,
      projects,
      workspaces,
      researchNavigation: navigation,
      navigation: this.profile.navigation(),
      nodes: parts.flatMap((p) => p.state.nodes),
      reports: parts.flatMap((p) => p.state.reports),
      runs: parts.flatMap((p) => p.state.runs),
      messages: parts.flatMap((p) => p.state.messages),
      views: Object.assign({}, ...parts.map((p) => p.state.views)),
      settings: this.profile.settings.settings(),
      ...(active
        ? {
            storage: {
              directory: active.directory,
              database: join(
                active.legacy ? active.directory : projectData(active.directory),
                'research.sqlite',
              ),
              source: 'project' as const,
              legacy: active.legacy,
            },
          }
        : {}),
    }
  }
  async command(input: AppCommand) {
    if (this.changing) throw new Error('正在保存项目位置，请稍后重试')
    const command = commandSchema.parse(input)
    const slot =
      'nodeId' in command
        ? this.recordOwner(command.nodeId, 'nodes')
        : 'parentId' in command
          ? this.recordOwner(command.parentId, 'nodes')
          : 'runId' in command
            ? this.recordOwner(command.runId, 'runs')
            : 'workspaceId' in command
              ? this.owner(command.workspaceId)
              : this.current
    if (command.type === 'import-workspace') {
      const workspaceId = this.importResearch(slot, command.data)
      this.activate(workspaceId)
      return { id: workspaceId }
    }
    if ('nodeId' in command || 'parentId' in command) {
      const node = slot.store.node('nodeId' in command ? command.nodeId : command.parentId)
      if (slot.store.projectData.navigation()[node.workspaceId]?.archivedAt)
        throw new Error('此研究已归档，请先恢复研究')
    }
    const result = await slot.service.command(command)
    if (command.type === 'create-workspace' && result.id) {
      this.appendResearch(slot, result.id)
      this.activate(result.id)
    }
    return result
  }
  exportWorkspace(workspaceId: string) {
    return this.owner(id.parse(workspaceId)).service.exportWorkspace(workspaceId)
  }
  resetAgentSession(runId: string) {
    return this.recordOwner(id.parse(runId), 'runs').service.resetAgentSession(runId)
  }
  private async change<T>(work: () => Promise<T>) {
    if (this.changing) throw new Error('正在处理另一个项目操作')
    this.changing = true
    try {
      return await work()
    } finally {
      this.changing = false
    }
  }
  async createProject(
    input: { name: string; requestId: string },
    directory?: string,
  ): Promise<ProjectResult> {
    return this.change(async () => {
      const previous = this.profile.created(input.requestId)
      if (previous) {
        this.selectProject(previous.projectId)
        return previous
      }
      const label =
        input.name
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
          .replace(/[. ]+$/, '')
          .slice(0, 60) || 'project'
      const root =
        directory ??
        join(
          this.legacyDirectory,
          'projects',
          `${label}-${createHash('sha256').update(input.requestId).digest('hex').slice(0, 8)}`,
        )
      if (!directory) mkdirSync(root, { recursive: true })
      // Retry after publishing a folder but before indexing it must adopt only our own request.
      let record: ProjectRecord
      if (existsSync(join(projectData(root), 'research.sqlite'))) {
        record = inspectProject(root)
        if (record.project.id !== input.requestId) throw new Error('此文件夹已有项目数据')
      } else
        record = await writeProject(root, async (stage) => {
          const store = new ResearchStore(stage, projectStoreOptions(this.profile, root))
          try {
            store.projectData.ensure(input.name, input.requestId)
          } finally {
            store.close()
          }
        })
      const slot = this.makeSlot(projectData(root), root)
      this.slots.set(record.project.id, slot)
      this.remember(slot)
      this.profile.rememberCreated(input.requestId, record.project.id)
      this.selectProject(record.project.id)
      return { projectId: record.project.id }
    })
  }
  async openProject(directory: string): Promise<ProjectResult> {
    return this.change(async () => {
      const known = this.profile.projects().find((p) => p.directory === directory && p.legacy)
      const record = inspectProject(directory, !!known?.legacy)
      const previous = this.profile.projects().find((p) => p.project.id === record.project.id)
      if (
        previous &&
        previous.directory !== record.directory &&
        existsSync(
          join(
            previous.legacy ? previous.directory : projectData(previous.directory),
            'research.sqlite',
          ),
        )
      )
        throw new Error('此项目已从其他文件夹打开，请使用迁移项目')
      const current = this.slots.get(record.project.id)
      if (current && current.directory === record.directory) {
        this.recoverTransfers()
        this.selectProject(record.project.id)
        return { projectId: record.project.id, workspaceId: this.activeWorkspaceId || undefined }
      }
      if (current) {
        this.idle(current)
        current.service.shutdown()
        current.store.close()
        this.slots.delete(record.project.id)
      }
      const slot = this.makeSlot(
        record.legacy ? record.directory : projectData(record.directory),
        record.directory,
        record.legacy,
      )
      try {
        const project = slot.store.projectData.ensure(record.project.name)
        if (!slot.store.projectData.marks().some((mark) => mark.state === 'pending'))
          this.validate(slot)
        this.slots.set(project.id, slot)
        this.blocked.delete(record.project.id)
        this.remember(slot, { opened: true })
        this.recoverTransfers()
        this.selectProject(project.id)
        return { projectId: project.id, workspaceId: this.activeWorkspaceId || undefined }
      } catch (error) {
        slot.service.shutdown()
        slot.store.close()
        throw error
      }
    })
  }
  async projectCommand(input: ProjectCommand, directory?: string): Promise<ProjectResult> {
    const command = projectCommandSchema.parse(input)
    if (command.type === 'create-project') return this.createProject(command, directory)
    if (command.type === 'move-research')
      return this.moveResearch(command.workspaceId, command.projectId, command.requestId)
    if (this.changing) throw new Error('正在处理另一个项目操作')
    if (command.type === 'save-navigation') {
      this.profile.saveNavigation(command.navigation)
      return {}
    }
    if (command.type === 'select-project') {
      this.selectProject(command.projectId)
      return { projectId: command.projectId, workspaceId: this.activeWorkspaceId || undefined }
    }
    if (command.type === 'select-research') {
      this.activate(command.workspaceId)
      return { projectId: this.activeProjectId, workspaceId: command.workspaceId }
    }
    if (command.type === 'close-project') {
      this.closeProject(command.projectId)
      return { projectId: command.projectId }
    }
    const slot =
      'workspaceId' in command ? this.owner(command.workspaceId) : this.slot(command.projectId)
    const project = this.info(slot)
    switch (command.type) {
      case 'create-research': {
        let workspaceId = slot.store.projectData.request(command.requestId)
        if (!workspaceId)
          slot.store.transaction(() => {
            workspaceId = slot.store.createWorkspace(
              command.question,
              command.name,
              command.constraints,
            )
            this.appendResearch(slot, workspaceId!)
            slot.store.projectData.rememberRequest(command.requestId, workspaceId!)
          })
        this.activate(workspaceId!)
        return { projectId: this.activeProjectId, workspaceId }
      }
      case 'import-research': {
        const workspaceId = this.importResearch(slot, command.data)
        this.activate(workspaceId)
        return { projectId: project.id, workspaceId }
      }
      case 'rename-project':
        slot.store.projectData.update({
          ...project,
          name: command.name,
          updatedAt: new Date().toISOString(),
        })
        break
      case 'rename-research':
        if (slot.store.projectData.navigation()[command.workspaceId]?.archivedAt)
          throw new Error('此研究已归档，请先恢复研究')
        slot.store.renameWorkspace(command.workspaceId, command.name)
        break
      case 'pin-project':
        this.remember(slot, { pinned: command.pinned })
        break
      case 'pin-research':
        slot.store.projectData.preference(command.workspaceId, { pinned: command.pinned })
        break
      case 'reorder-project': {
        this.slot(command.targetProjectId)
        const list = this.records()
        const source = list.find((p) => p.project.id === project.id)!,
          destination = list.find((p) => p.project.id === command.targetProjectId)!
        if (!!source.pinned !== !!destination.pinned)
          throw new Error('固定项目在前，请在同类项目之间调整顺序')
        if (project.id === command.targetProjectId) break
        const at = list.findIndex((p) => p.project.id === project.id),
          [moving] = list.splice(at, 1),
          target = list.findIndex((p) => p.project.id === command.targetProjectId)
        list.splice(target + (command.placement === 'after' ? 1 : 0), 0, moving)
        this.profile.reorder(list.map((entry) => entry.project.id))
        break
      }
      case 'reorder-research': {
        if (this.owner(command.targetWorkspaceId) !== slot)
          throw new Error('只能在同一项目内调整研究顺序')
        const nav = slot.store.projectData.navigation(),
          list = this.read(slot)
            .workspaces.slice()
            .sort((a, b) => (nav[a.id]?.order ?? 0) - (nav[b.id]?.order ?? 0))
        if (nav[command.workspaceId]?.archivedAt || nav[command.targetWorkspaceId]?.archivedAt)
          throw new Error('请先恢复已归档的研究')
        if (command.workspaceId === command.targetWorkspaceId) break
        const at = list.findIndex((w) => w.id === command.workspaceId),
          [moving] = list.splice(at, 1),
          target = list.findIndex((w) => w.id === command.targetWorkspaceId)
        list.splice(target + (command.placement === 'after' ? 1 : 0), 0, moving)
        slot.store.transaction(() =>
          list.forEach((entry, index) =>
            slot.store.projectData.preference(entry.id, { order: index }),
          ),
        )
        break
      }
      case 'archive-research': {
        if (
          slot.store
            .snapshot()
            .runs.some((run) => run.workspaceId === command.workspaceId && run.status === 'running')
        )
          throw new Error('请先结束该研究的运行')
        const navigation = slot.store.projectData.navigation(),
          siblings = this.read(slot)
            .workspaces.filter((w) => !navigation[w.id]?.archivedAt)
            .sort((a, b) => (navigation[a.id]?.order ?? 0) - (navigation[b.id]?.order ?? 0)),
          at = siblings.findIndex((w) => w.id === command.workspaceId),
          next = siblings[at + 1] ?? siblings[at - 1]
        slot.store.projectData.preference(command.workspaceId, {
          archivedAt: command.archived ? new Date().toISOString() : undefined,
        })
        if (command.archived && this.activeWorkspaceId === command.workspaceId) {
          slot.store.projectData.update({ ...project, lastWorkspaceId: next?.id })
          if (next) this.activate(next.id)
          else this.chooseWorkspace()
        }
        break
      }
    }
    return { projectId: project.id }
  }
  relocationDirectory(projectId: string, directory: string) {
    return relocationFolder(this.slot(projectId).store.directory, directory)
  }
  async relocateProject(projectId: string, directory: string) {
    return this.change(async () => {
      const source = this.slot(projectId)
      this.idle(source)
      const root = this.relocationDirectory(projectId, directory)
      await writeProject(root, (stage) =>
        copyProject(
          source.store,
          stage,
          this.profile,
          root,
          this.read(source).workspaces.map((w) => w.id),
        ),
      )
      const next = this.makeSlot(projectData(root), root)
      try {
        this.remember(next, { opened: true })
      } catch (error) {
        next.service.shutdown()
        next.store.close()
        throw error
      }
      source.service.shutdown()
      source.store.close()
      this.slots.set(projectId, next)
      this.activeProjectId = projectId
      this.profile.activate(projectId)
      this.chooseWorkspace()
    })
  }
  private finishTransfer(transfer: Transfer) {
    const source = this.slots.get(transfer.source),
      target = this.slots.get(transfer.target)
    if (
      !source ||
      !target ||
      !existsSync(join(source.store.directory, 'research.sqlite')) ||
      !existsSync(join(target.store.directory, 'research.sqlite'))
    )
      throw new Error('移动恢复需要来源和目标项目，请重新打开文件夹')
    if (transfer.phase === 'prepared') {
      if (
        target.store.projectData
          .marks()
          .some((mark) => mark.id === transfer.id && mark.direction === 'in')
      )
        target.store.projectData.remove(transfer.workspaceId)
      target.store.projectData.mark({ ...transfer, direction: 'in', state: 'done' })
      source.store.projectData.mark({ ...transfer, direction: 'out', state: 'done' })
      this.profile.transfer({ ...transfer, phase: 'cancelled' })
    } else if (transfer.phase === 'committed') {
      if (!target.store.snapshot().workspaces.some((w) => w.id === transfer.workspaceId))
        throw new Error('目标研究缺失，已停止自动恢复')
      target.store.transaction(() => {
        if (
          target.store.projectData
            .marks()
            .some((mark) => mark.id === transfer.id && mark.state === 'pending')
        )
          this.appendResearch(target, transfer.workspaceId)
        target.store.projectData.mark({ ...transfer, direction: 'in', state: 'done' })
      })
      source.store.projectData.remove(transfer.workspaceId)
      source.store.projectData.mark({ ...transfer, direction: 'out', state: 'done' })
      this.profile.transfer({ ...transfer, phase: 'done' })
      if (this.profile.activeId === transfer.source) {
        this.profile.activate(transfer.target)
        const project = this.info(target)
        target.store.projectData.update({ ...project, lastWorkspaceId: transfer.workspaceId })
      }
    }
  }
  private recoverTransfers() {
    const transfers = this.profile.transfers()
    for (const transfer of transfers.filter(
      (t) => t.phase === 'prepared' || t.phase === 'committed',
    )) {
      try {
        this.finishTransfer(transfer)
        this.blocked.delete(transfer.source)
        this.blocked.delete(transfer.target)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.blocked.set(transfer.source, message)
        this.blocked.set(transfer.target, message)
      }
    }
    for (const [key, slot] of this.slots)
      if (
        slot.store.projectData
          .marks()
          .some((mark) => mark.state === 'pending' && !transfers.some((t) => t.id === mark.id))
      )
        this.blocked.set(key, '项目有未完成的移动，请回到原应用配置恢复')
  }
  private async moveResearch(
    workspaceId: string,
    targetId: string,
    requestId: string,
  ): Promise<ProjectResult> {
    return this.change(async () => {
      const previous = this.profile.transfers().find((t) => t.id === requestId)
      if (previous && (previous.workspaceId !== workspaceId || previous.target !== targetId))
        throw new Error('移动请求编号已用于其他操作')
      if (previous?.phase === 'cancelled') throw new Error('移动已取消，请重新发起')
      if (previous?.phase === 'done') {
        if (previous.workspaceId !== workspaceId || previous.target !== targetId)
          throw new Error('移动请求编号已用于其他操作')
        return { projectId: targetId, workspaceId }
      }
      const source = this.owner(workspaceId),
        target = this.slot(targetId),
        sourceId = this.info(source).id
      if (source === target) return { projectId: targetId, workspaceId }
      this.idle(source)
      this.idle(target)
      const rows = source.store.projectData.rows(workspaceId)
      const digest = (value: unknown) =>
        createHash('sha256').update(JSON.stringify(value)).digest('hex')
      const transfer: Transfer = {
        id: requestId,
        workspaceId,
        source: sourceId,
        target: targetId,
        phase: 'prepared',
      }
      this.profile.transfer(transfer)
      source.store.projectData.mark({ ...transfer, direction: 'out', state: 'pending' })
      this.options.fault?.('prepared')
      try {
        target.store.projectData.receive(rows, { ...transfer, direction: 'in', state: 'pending' })
        const copied = target.store.projectData.rows(workspaceId)
        // node_edits uses a database-local sequence, not a portable history identity.
        const normalized = (value: typeof rows) => ({
          ...value,
          node_edits: value.node_edits.map(({ id: _id, ...row }) => row),
        })
        if (digest(normalized(rows)) !== digest(normalized(copied)))
          throw new Error('移动核验失败，来源资料保留')
        this.options.fault?.('copied')
        this.profile.transfer({ ...transfer, phase: 'committed' })
        this.options.fault?.('committed')
        this.finishTransfer({ ...transfer, phase: 'committed' })
        this.options.fault?.('cleaned')
      } catch (error) {
        this.blocked.set(sourceId, '移动尚未恢复，请重开项目')
        this.blocked.set(targetId, '移动尚未恢复，请重开项目')
        throw error
      }
      this.remember(source)
      this.remember(target)
      this.activate(workspaceId)
      return { projectId: targetId, workspaceId }
    })
  }
  shutdown() {
    for (const slot of this.slots.values()) {
      slot.service.shutdown()
      if (slot.store.isOpen) slot.store.close()
    }
    this.slots.clear()
    this.profile.close()
  }
}
