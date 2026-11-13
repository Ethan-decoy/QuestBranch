import { DatabaseSync } from 'node:sqlite'
import {
  existsSync,
  constants,
  copyFileSync,
  createReadStream,
  lstatSync,
  statSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { ResearchStore } from './store'
import { workspaceSchema } from './storage-schemas'
import { projectSchema } from './project-data'
import type { ProjectProfile, ProjectRecord } from './project-profile'

export const projectData = (directory: string) => join(directory, '.questbranch')
export function projectFolder(directory: string) {
  if (!isAbsolute(directory) || !statSync(directory).isDirectory())
    throw new Error('请选择项目文件夹')
  const root = realpathSync(directory),
    data = projectData(root)
  if (existsSync(data) && (lstatSync(data).isSymbolicLink() || !lstatSync(data).isDirectory()))
    throw new Error('项目的 .questbranch 必须是普通文件夹')
  return root
}
export function relocationFolder(sourceDirectory: string, directory: string) {
  const root = projectFolder(directory),
    backups = join(realpathSync(sourceDirectory), 'backups'),
    archiveRoot = existsSync(backups) ? realpathSync(backups) : backups,
    within = relative(archiveRoot, root)
  if (!within || (!isAbsolute(within) && within !== '..' && !within.startsWith(`..${sep}`)))
    throw new Error('迁移目标不能位于源项目的备份目录中，请选择其他文件夹')
  return root
}
export function inspectProject(directory: string, legacy = false): ProjectRecord {
  const root = projectFolder(directory),
    database = join(legacy ? root : projectData(root), 'research.sqlite')
  if (
    !existsSync(database) ||
    !lstatSync(database).isFile() ||
    lstatSync(database).isSymbolicLink()
  )
    throw new Error('此文件夹没有可打开的 QB 研究项目')
  const db = new DatabaseSync(database, { readOnly: true })
  try {
    const version = Number(db.prepare('PRAGMA user_version').get()!.user_version)
    if (version < 1 || version > 4) throw new Error('项目数据库版本不受支持')
    if (
      db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok' ||
      db.prepare('PRAGMA foreign_key_check').all().length
    )
      throw new Error('项目数据库或归属关系校验失败')
    if (!legacy && Number(db.prepare('SELECT COUNT(*) AS n FROM settings').get()!.n))
      throw new Error('此数据库含有旧应用配置，请从原研究库迁移')
    const workspaces = db
      .prepare('SELECT payload FROM workspaces ORDER BY rowid')
      .all()
      .map((row) => workspaceSchema.parse(JSON.parse(String(row.payload))))
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='research_project'")
      .get()
    const info = table
      ? db.prepare('SELECT payload FROM research_project WHERE singleton=1').get()
      : undefined
    if (!info && workspaces.length !== 1) throw new Error('项目缺少有效的项目记录')
    const project = info
      ? projectSchema.parse(JSON.parse(String(info.payload)))
      : {
          id: workspaces[0].id,
          name: workspaces[0].name,
          createdAt: workspaces[0].createdAt,
          updatedAt: workspaces[0].updatedAt,
        }
    for (const workspace of workspaces) {
      const rootNode = db.prepare('SELECT workspace_id FROM nodes WHERE id=?').get(workspace.rootId)
      if (rootNode?.workspace_id !== workspace.id) throw new Error('项目缺少有效的根问题')
    }
    return { directory: root, project, workspaces, legacy }
  } finally {
    db.close()
  }
}
export function projectStoreOptions(profile: ProjectProfile, root: string) {
  return {
    settingsStore: profile.settings,
    credentialDatabase: profile.database,
    agentWorkingDirectory: root,
    seed: false,
  }
}
export async function writeProject(directory: string, fill: (stage: string) => Promise<void>) {
  const root = projectFolder(directory),
    data = projectData(root)
  if (existsSync(data))
    throw new Error('此文件夹已有 .questbranch 数据，请打开已有项目或选择其他文件夹')
  const stage = mkdtempSync(join(root, '.questbranch-staging-'))
  try {
    writeFileSync(join(stage, '.gitignore'), '*\n!.gitignore\n', { flag: 'wx' })
    await fill(stage)
    const db = new DatabaseSync(join(stage, 'research.sqlite'))
    try {
      if (
        db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok' ||
        db.prepare('PRAGMA foreign_key_check').all().length ||
        Number(db.prepare('SELECT COUNT(*) AS n FROM settings').get()!.n)
      )
        throw new Error('研究项目校验失败，原资料保留')
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } finally {
      db.close()
    }
    inspectProject(stage, true)
    if (existsSync(data)) throw new Error('目标项目已被创建，原资料保留')
    renameSync(stage, data)
    return inspectProject(root)
  } finally {
    const within = relative(root, resolve(stage))
    if (!within.startsWith('.questbranch-staging-') || within.includes(sep) || isAbsolute(within))
      throw new Error('无效的项目暂存目录')
    rmSync(stage, { recursive: true, force: true })
  }
}

async function recoveryArchives(source: string, destination: string) {
  const digest = async (path: string) => {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    return hash.digest('hex')
  }
  const copy = async (from: string, to: string): Promise<void> => {
    const info = lstatSync(from)
    if (info.isSymbolicLink()) throw new Error('恢复档案不能包含符号链接或目录联接')
    if (info.isDirectory()) {
      mkdirSync(to, { recursive: true })
      for (const name of readdirSync(from)) await copy(join(from, name), join(to, name))
    } else if (info.isFile()) {
      copyFileSync(from, to, constants.COPYFILE_EXCL)
      const [original, copied] = await Promise.all([digest(from), digest(to)])
      if (original !== copied) throw new Error('恢复档案副本校验失败，原资料保留')
    } else throw new Error('恢复档案必须是普通文件或文件夹')
  }
  try {
    lstatSync(source)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
  await copy(source, destination)
}
export async function copyProject(
  source: ResearchStore,
  stage: string,
  profile: ProjectProfile,
  root: string,
  workspaceIds: string[],
) {
  relocationFolder(source.directory, stage)
  await source.sessions.backup(join(stage, 'research.sqlite'))
  const upgraded = new ResearchStore(stage, {
    ...projectStoreOptions(profile, root),
    recoverRuns: false,
  })
  for (const workspace of upgraded.snapshot().workspaces)
    if (!workspaceIds.includes(workspace.id)) upgraded.projectData.remove(workspace.id)
  upgraded.close()
  const db = new DatabaseSync(join(stage, 'research.sqlite'))
  try {
    db.exec('PRAGMA secure_delete=ON; DELETE FROM settings; VACUUM;')
  } finally {
    db.close()
  }
  await recoveryArchives(join(source.directory, 'backups'), join(stage, 'backups'))
}
