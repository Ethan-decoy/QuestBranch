import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { ResearchStore } from '../src/desktop/store'

const [file, directory, backupDirectory] = process.argv.slice(2)
if (!file || !directory)
  throw new Error(
    '用法：tsx scripts/import-workspace.ts <研究文件.json> <已确认的数据目录> [本地备份目录]',
  )
const data = JSON.parse(readFileSync(resolve(file), 'utf8'))
const store = new ResearchStore(resolve(directory), {
  seed: false,
  recoverRuns: false,
  codec: {
    encrypt() {
      throw new Error('数据导入不应访问模型凭据')
    },
    decrypt() {
      throw new Error('数据导入不应访问模型凭据')
    },
  },
})
try {
  const before = store.snapshot()
  if (before.workspaces.some((workspace) => workspace.id === data.workspace?.id))
    throw new Error('此研究空间已经存在。导入不会覆盖已有研究。')
  if (backupDirectory) {
    mkdirSync(resolve(backupDirectory), { recursive: true })
    for (const workspace of before.workspaces)
      writeFileSync(
        resolve(backupDirectory, `${workspace.id}.questbranch.json`),
        JSON.stringify(store.exportWorkspace(workspace.id), null, 2),
        'utf8',
      )
  }
  const id = store.importWorkspace(data),
    after = store.snapshot()
  console.log(
    JSON.stringify(
      {
        workspaceId: id,
        name: data.workspace.name,
        dataDirectory: resolve(directory),
        nodes: after.nodes.filter((node) => node.workspaceId === id).length,
        reports: after.reports.filter((report) => report.workspaceId === id).length,
        preservedWorkspaces: before.workspaces.length,
        preservedRuns: before.runs.length,
      },
      null,
      2,
    ),
  )
} finally {
  store.close()
}
