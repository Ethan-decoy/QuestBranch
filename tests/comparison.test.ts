import { describe, expect, it } from 'vitest'
import { comparisonDimensions, comparisonInstruction } from '../src/research/comparison'
import { buildContext } from '../src/research/context'
import { starterResearch } from '../src/research/seed'
import { defaultSettings, type Snapshot } from '../src/research/types'

function sample(): Snapshot {
  const seed = starterResearch()
  return {
    version: 1,
    workspaces: [seed.workspace],
    nodes: seed.nodes,
    reports: seed.reports,
    messages: [],
    runs: [],
    views: {},
    settings: { ...defaultSettings, contextBudget: 4000 },
  }
}

describe('按共同维度比较选定报告版本', () => {
  it('整理共同维度，保留具体维度并拒绝空白或过长输入', () => {
    expect(comparisonDimensions('隐私边界\n维护成本；隐私边界;适用规模')).toEqual([
      '隐私边界',
      '维护成本',
      '适用规模',
    ])
    expect(() => comparisonDimensions(' \n ')).toThrow('至少一个')
    expect(() => comparisonDimensions('长'.repeat(121))).toThrow('120')
    expect(() =>
      comparisonDimensions(Array.from({ length: 13 }, (_, index) => `维度${index}`).join('\n')),
    ).toThrow('12')
  })
  it('综合指令明确使用所选版本、共同表格列与证据边界', () => {
    const reports = sample().reports
    const instruction = comparisonInstruction(
      [reports[0], reports[1]],
      ['隐私边界', '维护成本'],
      '关注个人长期使用。',
    )
    for (const text of [
      reports[0].id,
      reports[1].id,
      reports[0].createdAt,
      '隐私边界',
      '维护成本',
      'GFM Markdown',
      '适用条件',
      '未知项',
      '依据',
      '不自动评分',
      '关注个人长期使用。',
    ])
      expect(instruction).toContain(text)
    expect(() => comparisonInstruction([reports[0], reports[0]], ['成本'], '')).toThrow('不同')
  })
  it('显式旧版替代关联节点默认新版，原报告和版本均不被改写', () => {
    const snapshot = sample(),
      old = snapshot.reports.find((report) => report.nodeId === 'visual')!
    old.markdown = 'OLD_SELECTED_MATERIAL'
    snapshot.reports.push({
      ...old,
      id: 'new-visual-report',
      createdAt: '2099-01-01T00:00:00Z',
      markdown: 'LATEST_MUST_NOT_LEAK',
    })
    snapshot.nodes.find((node) => node.id === 'budget')!.relatedIds = ['visual']
    const before = structuredClone(snapshot)
    const context = buildContext(snapshot, 'budget', '比较明确选定的报告', [
      old.id,
      'report-context',
    ])
    expect(context.items.slice(0, 2).map((item) => item.reportId)).toEqual([
      old.id,
      'report-context',
    ])
    expect(
      context.items.filter((item) => item.reason === '用户明确指定').every((item) => item.included),
    ).toBe(true)
    expect(context.messages[1].content).toContain('OLD_SELECTED_MATERIAL')
    expect(context.messages[1].content).not.toContain('LATEST_MUST_NOT_LEAK')
    expect(context.items.some((item) => item.reportId === 'new-visual-report')).toBe(false)
    expect(snapshot).toEqual(before)
  })
  it('优先为两份所选材料留预算，不让祖先长报告挤掉其中一份', () => {
    const snapshot = sample()
    snapshot.reports.find((report) => report.nodeId === 'root')!.markdown = '背景'.repeat(20000)
    const ids = ['report-visual', 'report-context']
    const context = buildContext(snapshot, 'budget', '比较两份材料', ids)
    expect(context.items.filter((item) => ids.includes(item.reportId))).toHaveLength(2)
    expect(
      context.items.filter((item) => ids.includes(item.reportId)).every((item) => item.included),
    ).toBe(true)
    expect(context.estimatedTokens).toBeLessThanOrEqual(context.budget)
  })
  it('所选材料连摘要与来源都无法容纳时明确失败，不带缺失方案生成比较', () => {
    const snapshot = sample()
    for (const report of snapshot.reports.filter((report) =>
      ['visual', 'context'].includes(report.nodeId),
    )) {
      report.markdown = '原始材料'.repeat(10000)
      report.summary = '必须保留的方案认识'.repeat(2000)
    }
    expect(() =>
      buildContext(snapshot, 'budget', '比较', ['report-visual', 'report-context']),
    ).toThrow('上下文预算不足以包含所选报告')
    expect(snapshot.runs).toEqual([])
  })
  it('短正文比摘要更精简时仍可使用正文，缺失或跨空间版本被拒绝', () => {
    const snapshot = sample(),
      report = snapshot.reports.find((report) => report.id === 'report-visual')!
    report.markdown = '简短但完整的所选版本正文'
    report.summary = '长摘要'.repeat(6000)
    const context = buildContext(snapshot, 'budget', '比较', [report.id])
    expect(context.items.find((item) => item.reportId === report.id)).toMatchObject({
      included: true,
      excerpted: false,
    })
    expect(() => buildContext(snapshot, 'budget', '比较', ['missing'])).toThrow('引用的报告不存在')
    report.workspaceId = 'other'
    expect(() => buildContext(snapshot, 'budget', '比较', [report.id])).toThrow('引用的报告不存在')
  })
})
