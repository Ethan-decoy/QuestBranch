import { afterEach, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  renameSync,
  existsSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ProjectLibrary } from '../src/desktop/project-library'
import { ResearchStore } from '../src/desktop/store'
import { ResearchService } from '../src/desktop/service'
import { PiCredentialStore } from '../src/desktop/pi-credentials'
import { PiModels } from '../src/desktop/pi-models'
import { defaultSettings } from '../src/research/types'

const libraries: ProjectLibrary[] = [],
  roots: string[] = []
function fixture() {
  const parent = resolve('artifacts/project-library')
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(join(parent, 'test-'))
  roots.push(root)
  const stores = new Map<string, ResearchStore>()
  const make = (
    fault?: NonNullable<ConstructorParameters<typeof ProjectLibrary>[2]>['fault'],
    service?: (store: ResearchStore) => ResearchService,
  ) => {
    const library = new ProjectLibrary(join(root, 'legacy'), join(root, 'profile'), {
      fault,
      service: (store) => {
        stores.set(store.directory, store)
        return service?.(store) ?? new ResearchService(store)
      },
    })
    libraries.push(library)
    return library
  }
  const folder = (name: string) => {
    const path = join(root, name)
    mkdirSync(path)
    return path
  }
  return { root, stores, make, folder }
}
afterEach(async () => {
  for (const lib of libraries.splice(0)) lib.shutdown()
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve('artifacts/project-library') + sep))
      throw new Error('Unexpected cleanup')
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
const create = (lib: ProjectLibrary, name: string, directory?: string) =>
  lib.createProject({ name, requestId: randomUUID() }, directory)
const research = (lib: ProjectLibrary, projectId: string, question: string) =>
  lib.projectCommand({ type: 'create-research', projectId, question, requestId: randomUUID() })

it('persists arbitrary project drop order while retaining selection, collapse and research data', async () => {
  const f = fixture(),
    lib = f.make(),
    legacy = (await lib.snapshot()).activeProjectId!,
    a = await create(lib, 'A', f.folder('A')),
    b = await create(lib, 'B', f.folder('B')),
    c = await create(lib, 'C', f.folder('C')),
    study = await research(lib, c.projectId!, '原研究')
  await lib.projectCommand({
    type: 'save-navigation',
    navigation: { collapsed: [a.projectId!, b.projectId!], recent: [study.workspaceId!] },
  })
  const before = await lib.snapshot(),
    content = await lib.exportWorkspace(study.workspaceId!),
    drop = {
      type: 'reorder-project' as const,
      projectId: c.projectId!,
      targetProjectId: legacy,
      placement: 'before' as const,
    }
  await lib.projectCommand(drop)
  await lib.projectCommand(drop)
  expect((await lib.snapshot()).projects!.map((p) => p.id)).toEqual([
    c.projectId,
    legacy,
    a.projectId,
    b.projectId,
  ])
  await lib.projectCommand({
    type: 'reorder-project',
    projectId: c.projectId!,
    targetProjectId: a.projectId!,
    placement: 'after',
  })
  const expected = [legacy, a.projectId, c.projectId, b.projectId],
    after = await lib.snapshot()
  expect(after.projects!.map((p) => p.id)).toEqual(expected)
  expect(after.activeProjectId).toBe(before.activeProjectId)
  expect(after.activeWorkspaceId).toBe(before.activeWorkspaceId)
  expect(after.navigation).toEqual(before.navigation)
  expect(await lib.exportWorkspace(study.workspaceId!)).toEqual(content)
  lib.shutdown()
  const reopened = f.make(),
    state = await reopened.snapshot()
  expect(state.projects!.map((p) => p.id)).toEqual(expected)
  expect(state.activeWorkspaceId).toBe(study.workspaceId)
  expect(state.navigation).toEqual(before.navigation)
  expect(await reopened.exportWorkspace(study.workspaceId!)).toEqual(content)
})

it('preserves project pin boundaries and rolls back a failed multi-project ordering save', async () => {
  const f = fixture(),
    lib = f.make(),
    legacy = (await lib.snapshot()).activeProjectId!,
    a = await create(lib, 'A', f.folder('A')),
    b = await create(lib, 'B', f.folder('B'))
  await lib.projectCommand({ type: 'pin-project', projectId: a.projectId!, pinned: true })
  const pinnedOrder = (await lib.snapshot()).projects!.map((p) => p.id)
  await expect(
    lib.projectCommand({
      type: 'reorder-project',
      projectId: b.projectId!,
      targetProjectId: a.projectId!,
      placement: 'before',
    }),
  ).rejects.toThrow('同类项目')
  expect((await lib.snapshot()).projects!.map((p) => p.id)).toEqual(pinnedOrder)
  await lib.projectCommand({ type: 'pin-project', projectId: a.projectId!, pinned: false })
  const before = (await lib.snapshot()).projects!.map((p) => ({ id: p.id, order: p.order }))
  const raw = new DatabaseSync(join(f.root, 'profile', 'application.sqlite'))
  raw.exec(`CREATE TRIGGER reject_order_fixture BEFORE UPDATE ON projects
    WHEN OLD.id='${a.projectId}' AND json_extract(NEW.payload,'$.order')<>json_extract(OLD.payload,'$.order')
    BEGIN SELECT RAISE(ABORT,'injected_order_failure'); END;`)
  raw.close()
  await expect(
    lib.projectCommand({
      type: 'reorder-project',
      projectId: b.projectId!,
      targetProjectId: legacy,
      placement: 'before',
    }),
  ).rejects.toThrow('injected_order_failure')
  expect((await lib.snapshot()).projects!.map((p) => ({ id: p.id, order: p.order }))).toEqual(
    before,
  )
})

it('ignores a retired navigation mode while retaining project collapse and visit history', async () => {
  const f = fixture(),
    lib = f.make(),
    initial = await lib.snapshot(),
    collapsed = [initial.activeProjectId!],
    recent = [initial.workspaces[0].id]
  lib.shutdown()
  const profile = new DatabaseSync(join(f.root, 'profile', 'application.sqlite'))
  profile
    .prepare('INSERT OR REPLACE INTO profile_meta VALUES (?,?)')
    .run('navigation', JSON.stringify({ mode: 'archived', collapsed, recent }))
  profile.close()
  const reopened = f.make(),
    state = await reopened.snapshot()
  expect(state.navigation).toEqual({ collapsed, recent })
  expect(state.activeWorkspaceId).toBe(initial.activeWorkspaceId)
  expect(state.workspaces.map((w) => w.id)).toEqual(initial.workspaces.map((w) => w.id))
})

it('creates an empty project and keeps two studies and shared encrypted connections after reopening', async () => {
  const f = fixture(),
    lib = f.make(),
    a = f.folder('A'),
    b = f.folder('B')
  writeFileSync(join(a, 'notes.md'), 'keep this document')
  const first = await create(lib, '项目 A', a)
  expect((await lib.snapshot()).activeWorkspaceId).toBe('')
  const one = await research(lib, first.projectId!, '问题一'),
    two = await research(lib, first.projectId!, '问题二')
  const second = await create(lib, '项目 B', b)
  const storeA = f.stores.get(join(a, '.questbranch'))!,
    storeB = f.stores.get(join(b, '.questbranch'))!
  storeA.saveModelCredential('shared', {
    type: 'oauth',
    access: 'global-access',
    refresh: 'global-refresh',
    expires: Date.now() + 3600000,
  })
  const ca = new PiCredentialStore(storeA, 'shared', 'fixture'),
    cb = new PiCredentialStore(storeB, 'shared', 'fixture')
  const update = async (current: Awaited<ReturnType<typeof ca.read>>) => {
    if (current?.type !== 'oauth') throw new Error('missing')
    return { ...current, access: current.access + '+' }
  }
  await Promise.all([ca.modify('fixture', update), cb.modify('fixture', update)])
  expect(await cb.read('fixture')).toMatchObject({ access: 'global-access++' })
  expect(storeA.snapshot().workspaces.map((w) => w.id)).toEqual([one.workspaceId, two.workspaceId])
  expect(storeA.agentWorkingDirectory).toBe(a)
  expect(readFileSync(join(a, 'notes.md'), 'utf8')).toBe('keep this document')
  for (const path of [a, b]) {
    const db = new DatabaseSync(join(path, '.questbranch', 'research.sqlite'))
    expect(db.prepare('SELECT COUNT(*) AS n FROM settings').get()!.n).toBe(0)
    db.close()
    expect(existsSync(join(path, '.questbranch', '.credential-key'))).toBe(false)
  }
  await lib.projectCommand({ type: 'select-project', projectId: first.projectId! })
  expect((await lib.snapshot()).activeWorkspaceId).toBe(two.workspaceId)
  lib.shutdown()
  const reopened = f.make(),
    state = await reopened.snapshot()
  expect(state.activeProjectId).toBe(first.projectId)
  expect(state.workspaces.filter((w) => w.projectId === first.projectId)).toHaveLength(2)
  expect(state.projects?.find((p) => p.id === second.projectId)?.available).toBe(true)
})

it('upgrades a v3 single-study folder without changing writable session, native binding or report identities', async () => {
  const f = fixture(),
    folder = f.folder('old'),
    data = join(folder, '.questbranch')
  const old = new ResearchStore(data, { seed: false }),
    workspaceId = old.createWorkspace('原研究')
  const root = old.snapshot().workspaces[0].rootId
  const session = old.sessions.owner(workspaceId, root, 'native-owner')
  await old.sessions.update(session.sessionId, 0, () => ({
    revision: 1,
    version: 4,
    sessionId: session.sessionId,
    checkpoints: [{ keep: true }],
    messages: [{ role: 'user', content: '原文' }],
  }))
  old.sessions.saveResult(session.sessionId, 'tool-1', {
    value: { retained: true },
    summary: '真实操作回执',
  })
  old.agentSessionBindings.save(root, 'binding', {
    sessionId: 'external',
    materialDigest: '',
    bootstrapped: true,
  })
  old.saveView(workspaceId, {
    selectedId: root,
    collapsed: [],
    drafts: {},
    chatDrafts: { [root]: '未发草稿' },
  })
  const exported = old.exportWorkspace(workspaceId),
    binding = old.agentSessionBindings.load(root, 'binding')
  old.close()
  const raw = new DatabaseSync(join(data, 'research.sqlite'))
  raw.exec('PRAGMA user_version=3')
  raw.close()
  const lib = f.make(),
    opened = await lib.openProject(folder)
  expect(opened.projectId).not.toBe(workspaceId)
  expect(await lib.exportWorkspace(workspaceId)).toEqual(exported)
  const store = f.stores.get(data)!
  expect(await store.sessions.load(session.sessionId)).toMatchObject({
    revision: 1,
    sessionId: session.sessionId,
  })
  expect(store.agentSessionBindings.load(root, 'binding')).toEqual(binding)
  expect(store.sessions.result(session.sessionId, 'tool-1')).toMatchObject({
    summary: '真实操作回执',
  })
  expect(existsSync(join(data, 'backups'))).toBe(true)
  await research(lib, opened.projectId!, '第二项研究')
  expect(store.snapshot().workspaces).toHaveLength(2)
})

it('moves a whole compatibility project with all studies, excludes credentials and never reactivates its old backup', async () => {
  const f = fixture(),
    lib = f.make(),
    initial = await lib.snapshot(),
    projectId = initial.activeProjectId!,
    workspaceId = initial.workspaces[0].id
  const second = await research(lib, projectId, '另一项研究')
  const before = await lib.exportWorkspace(workspaceId),
    destination = f.folder('moved')
  const originalDb = new DatabaseSync(join(f.root, 'legacy', 'research.sqlite'))
  originalDb
    .prepare('INSERT OR REPLACE INTO settings VALUES (?,?)')
    .run('apiKey', 'SHOULD-NOT-COPY')
  originalDb.close()
  await lib.relocateProject(projectId, destination)
  expect(await lib.exportWorkspace(workspaceId)).toEqual(before)
  expect((await lib.snapshot()).workspaces.some((w) => w.id === second.workspaceId)).toBe(true)
  expect(
    readFileSync(join(destination, '.questbranch', 'research.sqlite')).includes(
      Buffer.from('SHOULD-NOT-COPY'),
    ),
  ).toBe(false)
  lib.shutdown()
  const reopened = f.make(),
    state = await reopened.snapshot()
  expect(state.projects).toHaveLength(1)
  expect(state.storage?.directory).toBe(destination)
})

it.each(
  [false, true].flatMap((legacy) =>
    ['root', 'child', 'alias'].map((target) => ({ legacy, target })),
  ),
)(
  'rejects an overlapping recovery destination before copying: legacy=$legacy, target=$target',
  async ({ legacy, target }) => {
    const f = fixture(),
      lib = f.make(),
      initial = await lib.snapshot(),
      folder = legacy ? join(f.root, 'legacy') : f.folder('source'),
      projectId = legacy
        ? initial.activeProjectId!
        : (await create(lib, '目录校验', folder)).projectId!,
      study = await research(lib, projectId, '拒绝后仍可继续研究'),
      data = legacy ? folder : join(folder, '.questbranch'),
      store = f.stores.get(data)!,
      archives = join(data, 'backups'),
      child = join(archives, 'ordinary-folder')
    mkdirSync(child, { recursive: true })
    await store.sessions.backup(join(archives, 'recovery.sqlite'))
    writeFileSync(join(archives, 'backup.json'), '{"fixture":"overlap"}\n')
    writeFileSync(join(archives, '.credential-key'), 'historical-fixture-key')
    let destination = target === 'root' ? archives : child
    if (target === 'alias') {
      const alias = join(f.root, 'backup-alias')
      symlinkSync(archives, alias, process.platform === 'win32' ? 'junction' : 'dir')
      destination = join(alias, 'ordinary-folder')
    }
    const before = await lib.exportWorkspace(study.workspaceId!),
      files = ['recovery.sqlite', 'backup.json', '.credential-key'],
      bytes = files.map((file) => readFileSync(join(archives, file))),
      archiveEntries = readdirSync(archives).sort(),
      targetEntries = readdirSync(destination).sort()
    // Keep the pre-fix reproduction bounded: abort before it can recursively copy its own stage.
    const backup = vi
      .spyOn(store.sessions, 'backup')
      .mockRejectedValue(new Error('unexpected-migration-start'))
    await expect(lib.relocateProject(projectId, destination)).rejects.toThrow('备份目录')
    expect(backup).not.toHaveBeenCalled()
    backup.mockRestore()
    expect((await lib.snapshot()).storage?.directory).toBe(folder)
    expect(await lib.exportWorkspace(study.workspaceId!)).toEqual(before)
    expect(readdirSync(archives).sort()).toEqual(archiveEntries)
    expect(readdirSync(destination).sort()).toEqual(targetEntries)
    for (const [index, file] of files.entries())
      expect(readFileSync(join(archives, file))).toEqual(bytes[index])
    await lib.command({
      type: 'edit-node',
      nodeId: before.workspace.rootId,
      question: '原项目继续可用',
    })
    expect(
      (await lib.snapshot()).nodes.find((node) => node.id === before.workspace.rootId)?.question,
    ).toBe('原项目继续可用')
  },
)

it('allows a similarly named sibling of the recovery tree to receive a project', async () => {
  const f = fixture(),
    lib = f.make(),
    folder = f.folder('source'),
    project = await create(lib, '可迁移', folder),
    data = join(folder, '.questbranch'),
    archives = join(data, 'backups'),
    destination = join(data, 'backups-neighbor')
  await research(lib, project.projectId!, '保留研究')
  mkdirSync(archives)
  mkdirSync(destination)
  writeFileSync(join(archives, 'backup.json'), 'preserved archive')
  await lib.relocateProject(project.projectId!, destination)
  expect((await lib.snapshot()).storage?.directory).toBe(destination)
  expect(readFileSync(join(destination, '.questbranch', 'backups', 'backup.json'), 'utf8')).toBe(
    'preserved archive',
  )
})

it.each([false, true])(
  'carries recovery archives byte-for-byte when relocating a legacy=%s project',
  async (legacy) => {
    const f = fixture(),
      lib = f.make(),
      initial = await lib.snapshot(),
      folder = legacy ? join(f.root, 'legacy') : f.folder('project'),
      projectId = legacy
        ? initial.activeProjectId!
        : (await create(lib, '项目', folder)).projectId!,
      data = legacy ? folder : join(folder, '.questbranch'),
      store = f.stores.get(data)!,
      backup = join(data, 'backups', 'before-sessionweave-materials-v4'),
      destination = f.folder('moved-with-history')
    store.saveModelCredential('recovery-fixture', {
      type: 'oauth',
      access: 'current-global-access',
      refresh: 'current-global-refresh',
      expires: Date.now() + 3600000,
    })
    mkdirSync(backup, { recursive: true })
    await store.sessions.backup(join(backup, 'research.sqlite'))
    const historical = new DatabaseSync(join(backup, 'research.sqlite'))
    historical
      .prepare('INSERT OR REPLACE INTO settings VALUES (?,?)')
      .run('legacy-setting', 'historical-only')
    historical.close()
    writeFileSync(join(backup, '.credential-key'), Buffer.from('historical-recovery-key'))
    writeFileSync(
      join(backup, 'backup.json'),
      '{"feature":"sessionweave-materials-v4","historical":true}\n',
    )
    const schemaBackup = 'pre-projects-' + randomUUID()
    await store.sessions.backup(join(data, 'backups', schemaBackup + '.sqlite'))
    writeFileSync(
      join(data, 'backups', schemaBackup + '.credential-key'),
      Buffer.from('old-schema-key'),
    )
    writeFileSync(join(data, '.credential-key'), 'current-local-key-must-not-move')
    const files = [
        join('before-sessionweave-materials-v4', 'research.sqlite'),
        join('before-sessionweave-materials-v4', '.credential-key'),
        join('before-sessionweave-materials-v4', 'backup.json'),
        schemaBackup + '.sqlite',
        schemaBackup + '.credential-key',
      ],
      before = files.map((file) => readFileSync(join(data, 'backups', file)))
    await lib.relocateProject(projectId, destination)
    for (const [index, file] of files.entries()) {
      expect(readFileSync(join(destination, '.questbranch', 'backups', file))).toEqual(
        before[index],
      )
      expect(readFileSync(join(data, 'backups', file))).toEqual(before[index])
    }
    expect(existsSync(join(destination, '.questbranch', '.credential-key'))).toBe(false)
    expect(
      f.stores.get(join(destination, '.questbranch'))!.readModelCredential('recovery-fixture'),
    ).toMatchObject({ access: 'current-global-access' })
    const copied = new DatabaseSync(join(destination, '.questbranch', 'research.sqlite'), {
      readOnly: true,
    })
    expect(copied.prepare('SELECT COUNT(*) AS n FROM settings').get()!.n).toBe(0)
    copied.close()
    lib.shutdown()
    const reopened = f.make()
    expect((await reopened.snapshot()).storage?.directory).toBe(destination)
  },
)

it.each(['root', 'nested'])(
  'rejects %s recovery links without publishing a partial project or switching its location',
  async (kind) => {
    const f = fixture(),
      lib = f.make(),
      folder = f.folder('source'),
      project = await create(lib, '原项目', folder),
      destination = f.folder('destination'),
      external = f.folder('external')
    writeFileSync(join(external, 'keep.txt'), 'external data')
    const backups = join(folder, '.questbranch', 'backups')
    if (kind === 'nested') {
      mkdirSync(backups)
      await f.stores
        .get(join(folder, '.questbranch'))!
        .sessions.backup(join(backups, 'a-recovery.sqlite'))
    }
    symlinkSync(
      external,
      kind === 'root' ? backups : join(backups, 'z-external'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(lib.relocateProject(project.projectId!, destination)).rejects.toThrow(
      /恢复档案|链接/,
    )
    expect((await lib.snapshot()).storage?.directory).toBe(folder)
    expect(readdirSync(destination)).toEqual([])
    expect(readFileSync(join(external, 'keep.txt'), 'utf8')).toBe('external data')
  },
)

it('opens and exports archived research while retaining its archive flag, content and write restrictions', async () => {
  const f = fixture(),
    lib = f.make(),
    initial = await lib.snapshot(),
    workspace = initial.workspaces[0],
    before = await lib.exportWorkspace(workspace.id)
  expect(before.reports.length).toBeGreaterThan(0)
  await lib.projectCommand({ type: 'archive-research', workspaceId: workspace.id, archived: true })
  expect((await lib.snapshot()).activeWorkspaceId).not.toBe(workspace.id)
  const archivedAt = (await lib.snapshot()).researchNavigation![workspace.id].archivedAt
  await lib.projectCommand({ type: 'select-research', workspaceId: workspace.id })
  expect((await lib.snapshot()).activeWorkspaceId).toBe(workspace.id)
  expect((await lib.exportWorkspace(workspace.id)).reports).toEqual(before.reports)
  await lib.command({
    type: 'save-view',
    workspaceId: workspace.id,
    view: {
      selectedId: workspace.rootId,
      collapsed: [],
      drafts: {},
      readers: { [workspace.rootId]: { tab: 'report', reportId: before.reports[0].id } },
    },
  })
  await expect(
    lib.command({ type: 'edit-node', nodeId: workspace.rootId, question: '不得改写' }),
  ).rejects.toThrow('已归档')
  await expect(
    lib.command({ type: 'send-message', nodeId: workspace.rootId, message: '不得发送' }),
  ).rejects.toThrow('已归档')
  await expect(
    lib.projectCommand({ type: 'rename-research', workspaceId: workspace.id, name: '不得改名' }),
  ).rejects.toThrow('已归档')
  expect((await lib.snapshot()).researchNavigation![workspace.id].archivedAt).toBe(archivedAt)
  expect((await lib.exportWorkspace(workspace.id)).nodes).toEqual(before.nodes)
  expect((await lib.snapshot()).views[workspace.id].readers?.[workspace.rootId]?.tab).toBe('report')
})

it('renames only display names, archives and restores one identity, and closes without deleting data', async () => {
  const f = fixture(),
    lib = f.make(),
    folder = f.folder('A'),
    project = await create(lib, '原项目', folder)
  const first = await research(lib, project.projectId!, '原根问题'),
    second = await research(lib, project.projectId!, '另一根问题')
  const before = await lib.exportWorkspace(first.workspaceId!)
  await lib.projectCommand({
    type: 'rename-project',
    projectId: project.projectId!,
    name: '新项目名',
  })
  await lib.projectCommand({
    type: 'rename-research',
    workspaceId: first.workspaceId!,
    name: '简短标题',
  })
  const after = await lib.exportWorkspace(first.workspaceId!)
  expect(after.workspace.question).toBe(before.workspace.question)
  expect(after.nodes).toEqual(before.nodes)
  expect((await lib.snapshot()).storage?.directory).toBe(folder)
  await lib.projectCommand({
    type: 'archive-research',
    workspaceId: second.workspaceId!,
    archived: true,
  })
  expect((await lib.snapshot()).activeWorkspaceId).toBe(first.workspaceId)
  await lib.projectCommand({
    type: 'archive-research',
    workspaceId: second.workspaceId!,
    archived: false,
  })
  await lib.projectCommand({ type: 'close-project', projectId: project.projectId! })
  expect((await lib.snapshot()).projects?.some((p) => p.id === project.projectId)).toBe(false)
  expect(existsSync(join(folder, '.questbranch', 'research.sqlite'))).toBe(true)
  await lib.openProject(folder)
  expect((await lib.snapshot()).projects?.find((p) => p.id === project.projectId)?.name).toBe(
    '新项目名',
  )
})

it('keeps writable state and receipts when moving a study, and makes retries idempotent', async () => {
  const f = fixture(),
    lib = f.make(),
    a = f.folder('A'),
    b = f.folder('B'),
    pa = await create(lib, 'A', a),
    pb = await create(lib, 'B', b)
  const study = await research(lib, pa.projectId!, '完整移动'),
    store = f.stores.get(join(a, '.questbranch'))!
  const root = store.snapshot().workspaces[0].rootId,
    owner = store.sessions.owner(study.workspaceId!, root, 'fixture')
  await store.sessions.update(owner.sessionId, 0, () => ({
    revision: 1,
    sessionId: owner.sessionId,
    opaque: 'keep',
  }))
  store.sessions.saveResult(owner.sessionId, 'call-1', { value: true, summary: '已经成功' })
  const before = await lib.exportWorkspace(study.workspaceId!),
    requestId = randomUUID()
  const move = {
    type: 'move-research' as const,
    workspaceId: study.workspaceId!,
    projectId: pb.projectId!,
    requestId,
  }
  await lib.projectCommand(move)
  await lib.projectCommand(move)
  expect(await lib.exportWorkspace(study.workspaceId!)).toEqual(before)
  expect((await lib.snapshot()).workspaces.filter((w) => w.id === study.workspaceId)).toEqual([
    expect.objectContaining({ projectId: pb.projectId }),
  ])
  expect(await f.stores.get(join(b, '.questbranch'))!.sessions.load(owner.sessionId)).toMatchObject(
    { opaque: 'keep', revision: 1 },
  )
})

for (const phase of ['prepared', 'copied', 'committed', 'cleaned'] as const)
  it(`recovers a process interruption at transfer phase ${phase}`, async () => {
    const f = fixture(),
      lib = f.make((at) => {
        if (at === phase) throw new Error('injected exit')
      }),
      a = await create(lib, 'A', f.folder('A')),
      b = await create(lib, 'B', f.folder('B'))
    const study = await research(lib, a.projectId!, '不可丢失的研究'),
      before = await lib.exportWorkspace(study.workspaceId!)
    await expect(
      lib.projectCommand({
        type: 'move-research',
        workspaceId: study.workspaceId!,
        projectId: b.projectId!,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('injected')
    lib.shutdown()
    const reopened = f.make(),
      state = await reopened.snapshot(),
      matches = state.workspaces.filter((w) => w.id === study.workspaceId)
    expect(matches).toHaveLength(1)
    expect(matches[0].projectId).toBe(
      phase === 'prepared' || phase === 'copied' ? a.projectId : b.projectId,
    )
    expect(await reopened.exportWorkspace(study.workspaceId!)).toEqual(before)
  })

it('recovers a moved folder, refuses duplicate copies and does not overwrite corrupt metadata', async () => {
  const f = fixture(),
    lib = f.make(),
    folder = f.folder('original'),
    project = await create(lib, '保持身份', folder)
  await research(lib, project.projectId!, '保留研究')
  lib.shutdown()
  const moved = join(f.root, 'renamed')
  renameSync(folder, moved)
  const reopened = f.make()
  expect(
    (await reopened.snapshot()).projects?.find((p) => p.id === project.projectId)?.available,
  ).toBe(false)
  expect((await reopened.openProject(moved)).projectId).toBe(project.projectId)
  const duplicate = f.folder('duplicate')
  mkdirSync(join(duplicate, '.questbranch'))
  await f.stores
    .get(join(moved, '.questbranch'))!
    .sessions.backup(join(duplicate, '.questbranch', 'research.sqlite'))
  await expect(reopened.openProject(duplicate)).rejects.toThrow('其他文件夹')
  const broken = f.folder('broken')
  mkdirSync(join(broken, '.questbranch'))
  writeFileSync(join(broken, '.questbranch', 'research.sqlite'), 'invalid')
  await expect(reopened.openProject(broken)).rejects.toThrow()
  expect(readFileSync(join(broken, '.questbranch', 'research.sqlite'), 'utf8')).toBe('invalid')
})

it('keeps a running reply scoped to its originating study while navigating to a different project', async () => {
  const f = fixture()
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const seen = new Map<string, string>()
  const lib = new ProjectLibrary(join(f.root, 'legacy'), join(f.root, 'profile'), {
    service: (store) => {
      const models = new PiModels(store)
      vi.spyOn(models, 'generate').mockImplementation(async (_settings, _key, messages) => {
        seen.set(store.directory, messages.map((m) => m.content).join('\n'))
        if (store.agentWorkingDirectory.endsWith('A')) await gate
        return { raw: '实际回复' }
      })
      return new ResearchService(store, models)
    },
  })
  libraries.push(lib)
  const a = f.folder('A'),
    b = f.folder('B'),
    pa = await create(lib, 'A', a),
    pb = await create(lib, 'B', b),
    one = await research(lib, pa.projectId!, 'ONLY-QUESTION-A'),
    two = await research(lib, pb.projectId!, 'ONLY-QUESTION-B')
  await lib.command({
    type: 'save-settings',
    settings: {
      ...defaultSettings,
      provider: 'compatible',
      modelProvider: 'custom',
      baseUrl: 'http://127.0.0.1:1/v1',
      model: 'fixture',
      apiKey: 'fixture',
    },
  })
  const snap = await lib.snapshot(),
    nodeA = snap.workspaces.find((w) => w.id === one.workspaceId)!.rootId,
    nodeB = snap.workspaces.find((w) => w.id === two.workspaceId)!.rootId
  lib.activate(one.workspaceId!)
  const run = await lib.command({ type: 'send-message', nodeId: nodeA, message: '继续' })
  await vi.waitFor(() => expect(seen.has(join(a, '.questbranch'))).toBe(true))
  lib.activate(two.workspaceId!)
  await lib.command({ type: 'send-message', nodeId: nodeB, message: '继续' })
  release()
  await vi.waitFor(async () =>
    expect((await lib.snapshot()).runs.find((r) => r.id === run.id)?.status).toBe('completed'),
  )
  expect((await lib.snapshot()).activeWorkspaceId).toBe(two.workspaceId)
  expect(seen.get(join(a, '.questbranch'))).not.toContain('ONLY-QUESTION-B')
})

it('appends moved and new research, restores the adjacent study on archive, and rejects archived edits', async () => {
  const f = fixture(),
    lib = f.make(),
    a = await create(lib, 'A', f.folder('A')),
    b = await create(lib, 'B', f.folder('B')),
    request = {
      type: 'create-research' as const,
      projectId: a.projectId!,
      question: '原研究',
      requestId: randomUUID(),
    },
    moved = await lib.projectCommand(request),
    first = await research(lib, b.projectId!, '第一项'),
    second = await research(lib, b.projectId!, '第二项')
  await lib.projectCommand({
    type: 'move-research',
    workspaceId: moved.workspaceId!,
    projectId: b.projectId!,
    requestId: randomUUID(),
  })
  // Retrying the original creation must return the new owner, not create a second study.
  expect(await lib.projectCommand(request)).toEqual({
    projectId: b.projectId,
    workspaceId: moved.workspaceId,
  })
  const last = await research(lib, b.projectId!, '新追加')
  const state = await lib.snapshot(),
    nav = state.researchNavigation!
  const order = state.workspaces
    .filter((w) => w.projectId === b.projectId)
    .sort((x, y) => (nav[x.id]?.order ?? 0) - (nav[y.id]?.order ?? 0))
    .map((w) => w.id)
  expect(order).toEqual([
    first.workspaceId,
    second.workspaceId,
    moved.workspaceId,
    last.workspaceId,
  ])
  lib.activate(second.workspaceId!)
  await lib.projectCommand({
    type: 'archive-research',
    workspaceId: second.workspaceId!,
    archived: true,
  })
  expect((await lib.snapshot()).activeWorkspaceId).toBe(moved.workspaceId)
  lib.activate(second.workspaceId!)
  const nodeId = state.workspaces.find((w) => w.id === second.workspaceId)!.rootId
  await expect(lib.command({ type: 'edit-node', nodeId, question: '不得修改' })).rejects.toThrow(
    '已归档',
  )
  await expect(lib.command({ type: 'send-message', nodeId, message: '不得发送' })).rejects.toThrow(
    '已归档',
  )
  await lib.projectCommand({
    type: 'archive-research',
    workspaceId: second.workspaceId!,
    archived: false,
  })
  await lib.command({ type: 'edit-node', nodeId, question: '恢复后可修改' })
  expect((await lib.snapshot()).nodes.find((n) => n.id === nodeId)?.question).toBe('恢复后可修改')
})

it('upgrades the v1 index without exposing an already-extracted legacy backup as a duplicate study', async () => {
  const f = fixture(),
    folder = f.folder('extracted'),
    old = new ResearchStore(join(f.root, 'legacy')),
    workspace = old.snapshot().workspaces[0]
  mkdirSync(join(folder, '.questbranch'))
  await old.sessions.backup(join(folder, '.questbranch', 'research.sqlite'))
  old.close()
  const copied = new DatabaseSync(join(folder, '.questbranch', 'research.sqlite'))
  copied.exec('PRAGMA user_version=3; DELETE FROM research_project; DELETE FROM settings;')
  copied.close()
  mkdirSync(join(f.root, 'profile'))
  const index = new DatabaseSync(join(f.root, 'profile', 'application.sqlite'))
  index.exec(`PRAGMA user_version=1;
    CREATE TABLE projects (id TEXT PRIMARY KEY,directory TEXT NOT NULL UNIQUE,payload TEXT NOT NULL);
    CREATE TABLE profile_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);`)
  index
    .prepare('INSERT INTO projects VALUES (?,?,?)')
    .run(workspace.id, folder, JSON.stringify({ directory: folder, workspace }))
  index.prepare('INSERT INTO profile_meta VALUES (?,?)').run('active', workspace.id)
  index.close()
  const lib = f.make(),
    state = await lib.snapshot(),
    project = state.projects!.find((p) => p.directory === folder)!
  expect(state.workspaces.filter((w) => w.id === workspace.id)).toHaveLength(1)
  expect(project.id).not.toBe(workspace.id)
  expect(state.activeProjectId).toBe(project.id)
  expect(project.available).toBe(true)
  await lib.projectCommand({ type: 'close-project', projectId: project.id })
  expect((await lib.snapshot()).workspaces.some((w) => w.id === workspace.id)).toBe(false)
  lib.shutdown()
  const reopened = f.make()
  expect((await reopened.snapshot()).workspaces.some((w) => w.id === workspace.id)).toBe(false)
  await reopened.openProject(folder)
  expect((await reopened.snapshot()).workspaces.filter((w) => w.id === workspace.id)).toHaveLength(
    1,
  )
})

for (const phase of ['copied', 'committed'] as const)
  it(`recovers a ${phase} transfer when its missing destination is relocated and reopened`, async () => {
    const f = fixture(),
      lib = f.make((at) => {
        if (at === phase) throw new Error('exit')
      }),
      a = await create(lib, 'A', f.folder('A')),
      folderB = f.folder('B'),
      b = await create(lib, 'B', folderB),
      study = await research(lib, a.projectId!, '移动中的研究')
    await expect(
      lib.projectCommand({
        type: 'move-research',
        workspaceId: study.workspaceId!,
        projectId: b.projectId!,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('exit')
    lib.shutdown()
    const movedB = join(f.root, 'B-moved')
    renameSync(folderB, movedB)
    const reopened = f.make()
    expect(
      (await reopened.snapshot()).projects
        ?.filter((p) => p.id === a.projectId || p.id === b.projectId)
        .every((p) => !p.available),
    ).toBe(true)
    await reopened.openProject(movedB)
    const state = await reopened.snapshot()
    expect(state.projects?.every((p) => p.available)).toBe(true)
    expect(state.workspaces.filter((w) => w.id === study.workspaceId)).toEqual([
      expect.objectContaining({ projectId: phase === 'copied' ? a.projectId : b.projectId }),
    ])
  })

it('closes an unavailable project without deleting its registration or disk data', async () => {
  const f = fixture(),
    lib = f.make(),
    folder = f.folder('A'),
    a = await create(lib, 'A', folder),
    study = await research(lib, a.projectId!, '可恢复')
  lib.shutdown()
  const moved = join(f.root, 'moved')
  renameSync(folder, moved)
  const reopened = f.make()
  await reopened.projectCommand({ type: 'close-project', projectId: a.projectId! })
  expect((await reopened.snapshot()).projects?.some((p) => p.id === a.projectId)).toBe(false)
  await reopened.openProject(moved)
  expect((await reopened.snapshot()).workspaces.some((w) => w.id === study.workspaceId)).toBe(true)
})

it('rejects a duplicate cross-project import without leaving partially imported records', async () => {
  const f = fixture(),
    lib = f.make(),
    a = await create(lib, 'A', f.folder('A')),
    b = await create(lib, 'B', f.folder('B')),
    study = await research(lib, a.projectId!, '只有一个归属'),
    exported = await lib.exportWorkspace(study.workspaceId!)
  await expect(
    lib.projectCommand({ type: 'import-research', projectId: b.projectId!, data: exported }),
  ).rejects.toThrow(/已存在|标识冲突/)
  // Even a changed workspace identity must not smuggle colliding node IDs into another project.
  const changed = structuredClone(exported),
    nextId = randomUUID()
  changed.workspace.id = nextId
  for (const node of changed.nodes) node.workspaceId = nextId
  await expect(
    lib.projectCommand({ type: 'import-research', projectId: b.projectId!, data: changed }),
  ).rejects.toThrow('标识冲突')
  const state = await lib.snapshot()
  expect(state.workspaces.filter((w) => w.projectId === b.projectId)).toHaveLength(0)
  expect(state.nodes.filter((n) => n.workspaceId === nextId)).toHaveLength(0)
  await lib.projectCommand({ type: 'close-project', projectId: a.projectId! })
  await expect(
    lib.projectCommand({ type: 'import-research', projectId: b.projectId!, data: exported }),
  ).rejects.toThrow('已存在')
})

it('persists an arbitrary research drop position without changing selection, drafts or research contents', async () => {
  const f = fixture(),
    lib = f.make(),
    project = await create(lib, '排序', f.folder('sort'))
  const studies = []
  for (const question of ['第一项', '第二项', '第三项', '第四项'])
    studies.push((await research(lib, project.projectId!, question)).workspaceId!)
  const initial = await lib.snapshot(),
    active = studies[3],
    nodeId = initial.workspaces.find((w) => w.id === active)!.rootId
  await lib.command({
    type: 'save-view',
    workspaceId: active,
    view: {
      selectedId: nodeId,
      collapsed: [],
      drafts: {},
      chatDrafts: { [nodeId]: '排序不丢失草稿' },
    },
  })
  await lib.projectCommand({ type: 'pin-research', workspaceId: studies[0], pinned: true })
  const before = await lib.exportWorkspace(active),
    recent = (await lib.snapshot()).navigation
  const order = async (client: ProjectLibrary) => {
    const state = await client.snapshot(),
      nav = state.researchNavigation!
    return state.workspaces
      .filter((w) => w.projectId === project.projectId)
      .sort((a, b) => nav[a.id].order! - nav[b.id].order!)
      .map((w) => w.id)
  }
  const drop = {
    type: 'reorder-research' as const,
    workspaceId: active,
    targetWorkspaceId: studies[0],
    placement: 'before' as const,
  }
  await lib.projectCommand(drop)
  await lib.projectCommand(drop)
  expect(await order(lib)).toEqual([active, ...studies.slice(0, 3)])
  await lib.projectCommand({
    type: 'reorder-research',
    workspaceId: active,
    targetWorkspaceId: studies[1],
    placement: 'after',
  })
  const expected = [studies[0], studies[1], active, studies[2]]
  expect(await order(lib)).toEqual(expected)
  expect(await lib.exportWorkspace(active)).toEqual(before)
  expect((await lib.snapshot()).activeWorkspaceId).toBe(active)
  expect((await lib.snapshot()).navigation).toEqual(recent)
  expect((await lib.snapshot()).researchNavigation?.[studies[0]].pinned).toBe(true)
  lib.shutdown()
  const reopened = f.make()
  expect(await order(reopened)).toEqual(expected)
  expect(await reopened.exportWorkspace(active)).toEqual(before)
  expect((await reopened.snapshot()).activeWorkspaceId).toBe(active)
})

it('rejects a research drop across projects or onto archived research without changing either order', async () => {
  const f = fixture(),
    lib = f.make(),
    a = await create(lib, 'A', f.folder('A')),
    b = await create(lib, 'B', f.folder('B')),
    one = await research(lib, a.projectId!, 'A1'),
    two = await research(lib, a.projectId!, 'A2'),
    other = await research(lib, b.projectId!, 'B1')
  await lib.projectCommand({
    type: 'archive-research',
    workspaceId: two.workspaceId!,
    archived: true,
  })
  const before = (await lib.snapshot()).researchNavigation
  await expect(
    lib.projectCommand({
      type: 'reorder-research',
      workspaceId: one.workspaceId!,
      targetWorkspaceId: other.workspaceId!,
      placement: 'before',
    }),
  ).rejects.toThrow('同一项目')
  await expect(
    lib.projectCommand({
      type: 'reorder-research',
      workspaceId: one.workspaceId!,
      targetWorkspaceId: two.workspaceId!,
      placement: 'before',
    }),
  ).rejects.toThrow('归档')
  expect((await lib.snapshot()).researchNavigation).toEqual(before)
})

it('routes a pending account interaction to its originating project after switching', async () => {
  const f = fixture(),
    handlers = new Map<string, PiModels['auth']>(),
    sessions = new Map<
      string,
      { id: string; provider: string; status: 'pending'; message: string }
    >()
  const lib = f.make(undefined, (store) => {
    const models = new PiModels(store)
    handlers.set(store.directory, models.auth)
    vi.spyOn(models.auth, 'pending', 'get').mockImplementation(() => sessions.has(store.directory))
    vi.spyOn(models.auth, 'start').mockImplementation(async () => {
      const session = {
        id: randomUUID(),
        provider: 'fixture',
        status: 'pending' as const,
        message: 'fixture',
      }
      sessions.set(store.directory, session)
      return session
    })
    vi.spyOn(models.auth, 'status').mockImplementation(async (id) => {
      const session = sessions.get(store.directory)
      if (session?.id !== id) throw new Error('wrong auth owner')
      return session
    })
    vi.spyOn(models.auth, 'respond').mockResolvedValue(undefined)
    vi.spyOn(models.auth, 'cancel').mockImplementation(async () => {
      sessions.delete(store.directory)
    })
    return new ResearchService(store, models)
  })
  const folderA = f.folder('A'),
    folderB = f.folder('B'),
    a = await create(lib, 'A', folderA),
    b = await create(lib, 'B', folderB)
  await lib.projectCommand({ type: 'select-project', projectId: a.projectId! })
  const auth = await lib.auth.start(defaultSettings, 'oauth')
  await lib.projectCommand({ type: 'select-project', projectId: b.projectId! })
  expect(await lib.auth.status(auth.id)).toEqual(auth)
  await lib.auth.respond(auth.id, 'prompt', 'answer')
  expect(handlers.get(join(folderA, '.questbranch'))!.respond).toHaveBeenCalledWith(
    auth.id,
    'prompt',
    'answer',
  )
  expect(handlers.get(join(folderB, '.questbranch'))!.respond).not.toHaveBeenCalled()
  await expect(
    lib.projectCommand({ type: 'close-project', projectId: a.projectId! }),
  ).rejects.toThrow('账号连接')
  await lib.auth.cancel(auth.id)
  await lib.projectCommand({ type: 'close-project', projectId: a.projectId! })
  expect(() => lib.auth.status(auth.id)).toThrow('账号连接已结束')
})

it('routes real ACP authentication and configuration by connection identity after switching projects', async () => {
  const f = fixture(),
    lib = f.make(),
    folderA = f.folder('A'),
    folderB = f.folder('B'),
    a = await create(lib, 'A', folderA),
    b = await create(lib, 'B', folderB),
    config = {
      kind: 'custom' as const,
      command: process.execPath,
      args: [resolve('tests/fixtures/acp-agent.mjs'), 'auth'],
    }
  await lib.projectCommand({ type: 'select-project', projectId: a.projectId! })
  const connection = await lib.agent.connect(config)
  expect(connection.status).toBe('login-required')
  await lib.agent.authenticate(connection.id, 'device-code')
  await lib.projectCommand({ type: 'select-project', projectId: b.projectId! })
  await vi.waitFor(async () =>
    expect((await lib.agent.state(connection.id)).requests).toHaveLength(1),
  )
  const request = (await lib.agent.state(connection.id)).requests[0]
  await lib.agent.respond(connection.id, request.id, { action: 'accept' })
  await vi.waitFor(async () =>
    expect((await lib.agent.state(connection.id)).status).toBe('connected'),
  )
  expect((await lib.agent.configure(connection.id, 'model', 'fixture-deep')).options[0].value).toBe(
    'fixture-deep',
  )
  expect(existsSync(join(folderA, 'fixture-authenticated'))).toBe(true)
  expect(existsSync(join(folderB, 'fixture-authenticated'))).toBe(false)
  const other = await lib.agent.connect(config)
  expect(other.status).toBe('login-required')
  await lib.agent.disconnect(other.id)
  expect((await lib.agent.state(connection.id)).status).toBe('connected')
  await lib.agent.disconnect(connection.id)
}, 15000)
