import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { rm, rmdir } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { backup, DatabaseSync } from 'node:sqlite'
import type { ResearchStore } from './store'

export type StorageLocation = {
  directory: string
  source: 'default' | 'preference' | 'environment'
}
const preferenceName = 'storage-location.json'

export function loadStorageLocation(userData: string, override?: string): StorageLocation {
  if (override) return { directory: resolve(override), source: 'environment' }
  const file = join(userData, preferenceName)
  if (!existsSync(file)) return { directory: join(userData, 'research'), source: 'default' }
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))
    if (value.version !== 1 || typeof value.directory !== 'string' || !isAbsolute(value.directory))
      throw new Error('保存位置配置格式无效')
    // A disconnected drive must never silently become a fresh, empty research space.
    if (!existsSync(join(value.directory, 'research.sqlite')))
      throw new Error('找不到研究数据库，请确认磁盘已连接、目录可用')
    return { directory: value.directory, source: 'preference' }
  } catch (error) {
    throw new Error(
      `无法打开自选研究位置：${error instanceof Error ? error.message : '配置读取失败'}。位置配置：${file}`,
    )
  }
}

function isWithin(parent: string, child: string) {
  const path = relative(parent, child)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

export function validateStorageDestination(source: string, destination: string) {
  if (!isAbsolute(destination)) throw new Error('请选择完整的文件夹路径')
  const target = realpathSync(destination)
  if (isWithin(realpathSync(source), target)) throw new Error('请选择当前研究目录以外的空文件夹')
  if (readdirSync(target).length) throw new Error('请选择空文件夹，已有文件或研究资料不会被覆盖')
  return target
}

function databaseShape(db: DatabaseSync) {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[]
  return JSON.stringify({
    schema: db.prepare('PRAGMA user_version').get(),
    revision: db.prepare("SELECT value FROM meta WHERE key='version'").get(),
    tables: tables.map(({ name }) => [
      name,
      db.prepare(`SELECT count(*) AS count FROM "${name.replaceAll('"', '""')}"`).get()!.count,
    ]),
  })
}

async function saveStorageLocation(userData: string, directory: string) {
  mkdirSync(userData, { recursive: true })
  const temporary = join(userData, `storage-location.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, directory }, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
      flush: true,
    })
    renameSync(temporary, join(userData, preferenceName))
  } finally {
    await rm(temporary, { force: true })
  }
}

/** The desktop host freezes writes and waits for live runs before invoking this operation. */
export async function relocateResearchStorage(
  store: ResearchStore,
  userData: string,
  destination: string,
) {
  if (store.snapshot().runs.some((run) => run.status === 'running'))
    throw new Error('请等待当前对话或研究结束，或停止研究后再迁移')
  const target = validateStorageDestination(store.directory, destination)
  const staging = mkdtempSync(join(target, '.questbranch-migration-'))
  const created: string[] = []
  const createdDirectories: string[] = []
  let committed = false
  try {
    const source = new DatabaseSync(join(store.directory, 'research.sqlite'), { readOnly: true })
    try {
      const expected = databaseShape(source)
      // SQLite's backup API includes committed WAL data; a raw file copy would omit it.
      await backup(source, join(staging, 'research.sqlite'))
      const copied = new DatabaseSync(join(staging, 'research.sqlite'), { readOnly: true })
      try {
        const check = copied.prepare('PRAGMA quick_check').all()
        if (
          check.length !== 1 ||
          check[0].quick_check !== 'ok' ||
          copied.prepare('PRAGMA foreign_key_check').all().length ||
          databaseShape(copied) !== expected
        )
          throw new Error('研究副本校验失败，仍使用原保存位置')
      } finally {
        copied.close()
      }
    } finally {
      source.close()
    }
    const files = ['research.sqlite']
    if (existsSync(join(store.directory, '.credential-key'))) {
      copyFileSync(join(store.directory, '.credential-key'), join(staging, '.credential-key'))
      files.push('.credential-key')
    }
    const upgradeBackup = join('backups', 'before-sessionweave-materials-v4')
    if (existsSync(join(store.directory, upgradeBackup))) {
      mkdirSync(join(staging, upgradeBackup), { recursive: true })
      const backupFiles = ['research.sqlite', 'backup.json']
      if (existsSync(join(store.directory, upgradeBackup, '.credential-key')))
        backupFiles.push('.credential-key')
      for (const file of backupFiles) {
        const relativePath = join(upgradeBackup, file)
        copyFileSync(join(store.directory, relativePath), join(staging, relativePath))
        files.push(relativePath)
      }
      for (const directory of [join(target, 'backups'), join(target, upgradeBackup)]) {
        mkdirSync(directory)
        createdDirectories.push(directory)
      }
    }
    for (const file of files) {
      const path = join(target, file)
      copyFileSync(join(staging, file), path, constants.COPYFILE_EXCL)
      created.push(path)
    }
    // The location pointer is the commit point. The source is retained in every outcome.
    await saveStorageLocation(userData, target)
    committed = true
    return target
  } finally {
    if (!committed) {
      for (const path of created) await rm(path, { force: true })
      for (const directory of createdDirectories.reverse()) {
        // Only remove our empty directories; never recursively erase another writer's files.
        try {
          await rmdir(directory)
        } catch {}
      }
    }
    const cleanup = resolve(staging)
    if (
      relative(target, cleanup) === basename(cleanup) &&
      basename(cleanup).startsWith('.questbranch-migration-')
    ) {
      // Cleanup must not turn a successful location switch into a reported migration failure.
      try {
        // Async rm handles non-ASCII Windows paths correctly on the supported Node runtime.
        await rm(cleanup, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
      } catch {}
    }
  }
}
