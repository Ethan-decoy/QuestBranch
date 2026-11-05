import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ResearchStore } from '../src/desktop/store'
import { ResearchService } from '../src/desktop/service'
import { branchReport } from '../src/research/branching'
import { buildContext } from '../src/research/context'
import type { Report, ResearchRun, ResearchOutput } from '../src/research/types'

const stores: ResearchStore[] = [],
  directories: string[] = []
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'qb-branching-'))
  directories.push(directory)
  const store = new ResearchStore(directory, { seed: false })
  stores.push(store)
  const workspaceId = store.createWorkspace('长期研究的根问题')
  const parentId = store.snapshot().workspaces[0].rootId
  return { store, workspaceId, parentId }
}
function savedReport(store: ResearchStore, nodeId: string, name: string = randomUUID()): Report {
  const node = store.node(nodeId)
  const report: Report = {
    id: name,
    nodeId,
    workspaceId: node.workspaceId,
    title: `报告 ${name}`,
    summary: `只属于 ${name} 的阶段认识`,
    markdown: `# ${name}\n\n这是一份仅供隔离验收的研究报告，研究结论仍有待判断。`,
    findings: ['阶段认识'],
    openQuestions: ['后续问题'],
    sources: [],
    origin: 'import',
    model: 'fixture',
    createdAt: new Date().toISOString(),
  }
  store.transaction(() => store.insertReport(report))
  return report
}
function running(store: ResearchStore, nodeId: string): ResearchRun {
  return {
    id: randomUUID(),
    workspaceId: store.node(nodeId).workspaceId,
    nodeId,
    instruction: '继续',
    status: 'running',
    phase: '测试',
    output: '',
    error: '',
    model: 'fixture',
    createdAt: new Date().toISOString(),
    context: buildContext(store.snapshot(), nodeId, ''),
  }
}
afterEach(() => {
  stores.splice(0).forEach((store) => store.close())
  for (const directory of directories.splice(0)) {
    if (
      !resolve(directory).startsWith(resolve(tmpdir()) + sep) ||
      !directory.includes('qb-branching-')
    )
      throw new Error('Unexpected test path')
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('报告派生约束', () => {
  it('无报告可创建根；仅聊天、运行、失败和取消均不允许派生', async () => {
    const { store, parentId } = setup(),
      service = new ResearchService(store)
    for (const status of ['running', 'failed', 'cancelled', 'completed'] as const) {
      store.saveRun({ ...running(store, parentId), mode: 'chat', status })
      expect(branchReport(store.snapshot(), parentId)).toBeUndefined()
      expect(() => store.createNode(parentId, '错误派生', '')).toThrow('先生成研究报告')
      await expect(
        service.command({
          type: 'create-node',
          parentId,
          question: '错误派生',
          sourceReportId: 'missing',
        }),
      ).rejects.toThrow('来源报告不存在')
    }
    expect(store.snapshot().nodes).toHaveLength(1)
  })
  it('旧报告仍可在后续失败或研究中派生；记录用户选定版本', () => {
    const { store, parentId } = setup(),
      r1 = savedReport(store, parentId, 'r1')
    savedReport(store, parentId, 'r2')
    store.saveRun({ ...running(store, parentId), status: 'failed' })
    store.saveRun(running(store, parentId))
    const view = { readers: { [parentId]: { tab: 'report' as const, reportId: r1.id } } }
    expect(branchReport(store.snapshot(), parentId, view)?.id).toBe(r1.id)
    const child = store.createNode(parentId, '独立子问题', r1.id, { requestId: undefined })
    expect(store.node(child).originReportId).toBe(r1.id)
    expect(branchReport(store.snapshot(), child)).toBeUndefined()
    expect(() => store.createNode(child, '不能越级', r1.id)).toThrow('必须属于父节点')
    const own = savedReport(store, child, 'child-report')
    expect(store.node(store.createNode(child, '下一层', own.id)).parentId).toBe(child)
  })
  it('跨父节点、跨空间、假报告和错误补充材料全部拒绝，不产生半批节点', () => {
    const { store, parentId } = setup(),
      r1 = savedReport(store, parentId, 'r1')
    const foreign = store.createWorkspace('另一个空间'),
      foreignRoot = store.snapshot().workspaces.find((w) => w.id === foreign)!.rootId
    const other = savedReport(store, foreignRoot, 'foreign')
    const before = store.snapshot()
    expect(() => store.createNode(parentId, '错误', other.id)).toThrow('必须属于父节点')
    expect(() => store.createNode(parentId, '错误', 'missing')).toThrow('来源报告不存在')
    expect(() =>
      store.createNode(parentId, '错误', r1.id, { referenceReportIds: [other.id] }),
    ).toThrow('不属于当前')
    expect(() =>
      store.createBranches({
        parentId,
        sourceReportId: r1.id,
        requestId: 'invalid',
        branches: [{ question: '好问题' }, { question: ' ' }],
      }),
    ).toThrow()
    expect(store.snapshot().nodes).toEqual(before.nodes)
    expect(store.snapshot().version).toBe(before.version)
  })
  it('幂等键持久化；同批、工具与自动方向重试不会重复，换载荷明确失败', () => {
    const { store, parentId, workspaceId } = setup(),
      r1 = savedReport(store, parentId, 'r1')
    const input = {
      parentId,
      sourceReportId: r1.id,
      requestId: 'same-request',
      branches: [{ question: 'B' }, { question: 'C' }, { question: 'B' }],
    }
    const first = store.createBranches(input)
    expect(store.snapshot().nodes).toHaveLength(3)
    expect(new Set(first.nodeIds).size).toBe(2)
    store.editNode(first.nodeIds[0], 'B 已人工改写')
    expect(store.createBranches(input)).toEqual(first)
    expect(() =>
      store.createBranches({ ...input, branches: [{ question: '另一个问题' }] }),
    ).toThrow('已用于其他内容')
    const directory = store.directory
    store.close()
    stores.splice(stores.indexOf(store), 1)
    const reopened = new ResearchStore(directory)
    stores.push(reopened)
    expect(reopened.createBranches(input)).toEqual(first)
    const restoredDirectory = mkdtempSync(join(tmpdir(), 'qb-branching-'))
    directories.push(restoredDirectory)
    const restored = new ResearchStore(restoredDirectory, { seed: false })
    stores.push(restored)
    restored.importWorkspace(reopened.exportWorkspace(workspaceId))
    expect(restored.createBranches(input)).toEqual(first)
    expect(restored.snapshot().nodes).toHaveLength(3)
  })
  it('报告保存和自动后续方向原子完成，并复用同一来源校验及幂等策略', () => {
    const { store, parentId } = setup(),
      run = running(store, parentId)
    store.saveRun(run)
    const output: ResearchOutput = {
      title: 'A 报告',
      summary: '认识',
      report: '这是一份完整的隔离测试报告，回答 A 的研究问题。',
      findings: [],
      openQuestions: [],
      followups: [
        { title: 'B', question: 'B的问题' },
        { title: 'B重复', question: 'B的问题' },
      ],
    }
    const reportId = store.complete(run.id, output)
    expect(store.complete(run.id, output)).toBe(reportId)
    const child = store.snapshot().nodes.find((node) => node.parentId === parentId)!
    expect(child.originReportId).toBe(reportId)
    const receipt = store.createBranches({
      parentId,
      sourceReportId: reportId,
      requestId: 'tool-retry',
      branches: [{ title: 'B', question: 'B的问题' }],
    })
    expect(receipt.nodeIds).toEqual([child.id])
    expect(store.snapshot().reports).toHaveLength(1)
    expect(store.snapshot().nodes).toHaveLength(2)
    const invalid = running(store, parentId)
    store.saveRun(invalid)
    expect(() =>
      store.complete(invalid.id, { ...output, followups: [{ title: '无效', question: '' }] }),
    ).toThrow()
    expect(store.run(invalid.id).status).toBe('running')
    expect(store.snapshot().reports).toHaveLength(1)
  })
})

describe('来源版本实际进入上下文', () => {
  it('直接来源固定R1；关联祖先不会偷偷补入R2，显式补充允许两版同时存在', () => {
    const { store, parentId } = setup()
    const r0 = savedReport(store, parentId, 'root-r1')
    const a = store.createNode(parentId, 'A的问题', r0.id)
    const r1 = savedReport(store, a, 'a-r1'),
      b = store.createNode(a, 'B的问题', r1.id)
    savedReport(store, a, 'a-r2')
    const b1 = savedReport(store, b, 'b-r1'),
      c = store.createNode(b, 'C的问题', b1.id, { relatedIds: [a] })
    let context = buildContext(store.snapshot(), c, '继续')
    expect(context.items.map((item) => item.reportId)).toEqual(
      expect.arrayContaining(['b-r1', 'a-r1', 'root-r1']),
    )
    expect(JSON.stringify(context)).not.toContain('a-r2')
    context = buildContext(store.snapshot(), b, '补充新版', ['a-r2'])
    expect(context.items.filter((item) => item.included).map((item) => item.reportId)).toEqual(
      expect.arrayContaining(['a-r1', 'a-r2']),
    )
    expect(context.messages[1].content).toContain(r1.markdown)
    expect(context.items.find((item) => item.reportId === r1.id)?.reason).toContain('固定版本')
    expect(store.node(b).originReportId).toBe(r1.id)
  })
  it('来源过大使用具名摘要；连摘要也装不下时拒绝，不启动带缺失材料的研究', () => {
    const { store, parentId } = setup(),
      r1 = savedReport(store, parentId, 'r1')
    const child = store.createNode(parentId, 'B的问题', r1.id),
      snapshot = store.snapshot()
    snapshot.settings.contextBudget = 4000
    snapshot.reports[0].markdown = '长正文'.repeat(10000)
    const pack = buildContext(snapshot, child, '继续')
    expect(pack.items.find((item) => item.reportId === 'r1')).toMatchObject({
      included: true,
      excerpted: true,
    })
    expect(pack.messages[1].content).toContain('仅摘要')
    snapshot.reports[0].summary = '长摘要'.repeat(4000)
    expect(() => buildContext(snapshot, child, '继续')).toThrow('预算不足')
  })
  it('旧节点和旧运行保留原状；本次回退注明且不写回历史来源', () => {
    const { store, parentId } = setup()
    const parent = store.node(parentId)
    store.insertNode({ ...parent, id: 'legacy-child', parentId })
    savedReport(store, parentId, 'new-parent-report')
    const pack = buildContext(store.snapshot(), 'legacy-child', '')
    expect(pack.limitations.join('\n')).toContain('未记录创建来源')
    expect(pack.items.find((item) => item.reportId === 'new-parent-report')?.included).toBe(true)
    expect(store.node('legacy-child').originReportId).toBeUndefined()
    const snapshot = store.snapshot()
    snapshot.nodes.find((node) => node.id === 'legacy-child')!.originReportId = 'missing'
    expect(() => buildContext(snapshot, 'legacy-child', '')).toThrow('来源报告不存在')
  })
  it('比较综合归属实际来源节点，确切的额外报告在后续研究与恢复中保留', async () => {
    const { store, parentId } = setup(),
      source = savedReport(store, parentId, 'root-r1')
    const a = store.createNode(parentId, '方向A', source.id),
      b = store.createNode(parentId, '方向B', source.id)
    const a1 = savedReport(store, a, 'a-r1'),
      b1 = savedReport(store, b, 'b-r1')
    const service = new ResearchService(store)
    const { id } = await service.command({
      type: 'create-node',
      parentId: a,
      sourceReportId: a1.id,
      referenceReportIds: [a1.id, b1.id],
      relatedIds: [b],
      question: '综合A与B',
    })
    savedReport(store, b, 'b-r2')
    expect(store.node(id!)).toMatchObject({
      parentId: a,
      originReportId: a1.id,
      referenceReportIds: [a1.id, b1.id],
    })
    const context = buildContext(store.snapshot(), id!, '继续综合')
    expect(context.items.filter((item) => item.included).map((item) => item.reportId)).toEqual(
      expect.arrayContaining([a1.id, b1.id]),
    )
    expect(JSON.stringify(context)).not.toContain('b-r2')
  })
})
