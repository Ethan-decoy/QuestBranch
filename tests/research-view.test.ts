import { describe, expect, it } from 'vitest'
import { starterResearch } from '../src/research/seed'
import { defaultSettings, type Snapshot, type ViewState } from '../src/research/types'
import {
  graphPresentation,
  visibleResearchRows,
  scopedResearch,
  relatedResearch,
  transitionView,
} from '../src/ui/research-view'
import { searchResearch } from '../src/ui/research-search'
import { layoutGraph, CARD_WIDTH, CARD_HEIGHT, COMPACT_CARD_HEIGHT } from '../src/ui/layout'

const seed = starterResearch()
function view(): ViewState {
  return {
    selectedId: 'visual',
    collapsed: [],
    drafts: {},
    readers: {
      visual: { tab: 'report', reportId: 'report-visual', scroll: { 'report:report-visual': 842 } },
    },
  }
}
function snapshot(): Snapshot {
  return {
    version: 1,
    workspaces: [seed.workspace],
    nodes: structuredClone(seed.nodes),
    reports: structuredClone(seed.reports),
    runs: [],
    messages: [],
    views: { [seed.workspace.id]: view() },
    settings: defaultSettings,
  }
}
describe('研究视图的连续性', () => {
  it('关联跳转在全图中也保留折叠、原视角与阅读版本，双向关联只作导航', () => {
    const nodes = structuredClone(seed.nodes)
    nodes.find((node) => node.id === 'budget')!.relatedIds = ['visual']
    const original = { ...view(), collapsed: ['context'], viewport: { x: 17, y: 29, zoom: 0.8 } }
    expect(relatedResearch(nodes, 'visual').map((node) => node.id)).toContain('budget')
    let current = {
      ...original,
      ...transitionView(nodes, original, { type: 'related', nodeId: 'budget' }),
    }
    expect(current.collapsed).not.toContain('context')
    expect(current.graph?.history).toHaveLength(1)
    current = {
      ...current,
      ...transitionView(nodes, current, {
        type: 'scene',
        patch: { viewport: { x: -800, y: 10, zoom: 1 } },
      }),
    }
    current = { ...current, ...transitionView(nodes, current, { type: 'back' }) }
    expect(current.selectedId).toBe('visual')
    expect(current.collapsed).toEqual(original.collapsed)
    expect(graphPresentation(current).scene.viewport).toEqual(original.viewport)
    expect(current.readers).toEqual(original.readers)
    expect(nodes.find((node) => node.id === 'visual')!.relatedIds).toEqual(
      seed.nodes.find((node) => node.id === 'visual')!.relatedIds,
    )
  })
  it('关联跳出聚焦范围再返回，恢复原分支及视角，满场景缓存仍不超过64项', () => {
    const nodes = structuredClone(seed.nodes)
    nodes.find((node) => node.id === 'visual')!.relatedIds = ['budget']
    let original = {
      ...view(),
      ...transitionView(nodes, view(), { type: 'focus', nodeId: 'visual' }),
    }
    original = {
      ...original,
      ...transitionView(nodes, original, {
        type: 'scene',
        patch: { viewport: { x: 15, y: 30, zoom: 0.9 } },
      }),
    }
    let current = {
      ...original,
      ...transitionView(nodes, original, { type: 'related', nodeId: 'budget' }),
    }
    expect(current.graph?.focusId).toBeUndefined()
    current = {
      ...current,
      graph: {
        ...current.graph,
        scenes: Array.from({ length: 64 }, (_, index) => ({
          mode: 'horizontal' as const,
          detail: 'summary' as const,
          focusId: `cache-${index}`,
        })),
      },
    }
    current = { ...current, ...transitionView(nodes, current, { type: 'back' }) }
    expect(current.graph?.focusId).toBe('visual')
    expect(current.graph?.scenes).toHaveLength(64)
    expect(graphPresentation(current).scene.viewport).toEqual({ x: 15, y: 30, zoom: 0.9 })
  })
  it('聚焦暂时展开分支，返回时恢复原来的折叠范围', () => {
    const original = { ...view(), collapsed: ['visual', 'context'] },
      focused = {
        ...original,
        ...transitionView(seed.nodes, original, { type: 'focus', nodeId: 'visual' }),
      },
      returned = { ...focused, ...transitionView(seed.nodes, focused, { type: 'back' }) }
    expect(focused.collapsed).toEqual(['context'])
    expect(returned.collapsed).toEqual(original.collapsed)
    expect(returned.selectedId).toBe('visual')
  })
  it('旧版视图无需迁移即可保持横向布局及手动位置', () => {
    const legacy = {
      ...view(),
      viewport: { x: 12, y: 34, zoom: 0.8 },
      positions: { visual: { x: 33, y: 88 } },
    }
    expect(graphPresentation(legacy).scene.viewport).toEqual(legacy.viewport)
    expect(graphPresentation(legacy).scene.positions).toEqual(legacy.positions)
    expect(graphPresentation(legacy).mode).toBe('horizontal')
  })
  it('嵌套聚焦、切换表达后能恢复原布局、位置、选择和阅读记忆', () => {
    let current = view()
    const apply = (action: Parameters<typeof transitionView>[2]) => {
      current = { ...current, ...transitionView(seed.nodes, current, action) }
    }
    const original = { x: 61, y: 93, zoom: 0.83 }
    apply({
      type: 'scene',
      patch: { viewport: original, positions: { visual: { x: 132, y: 76 } } },
    })
    apply({ type: 'focus', nodeId: 'visual' })
    apply({ type: 'mode', mode: 'mindmap' })
    apply({ type: 'scene', patch: { viewport: { x: -3, y: 70, zoom: 0.95 } } })
    apply({ type: 'select', nodeId: 'layout' })
    apply({ type: 'focus', nodeId: 'layout' })
    apply({ type: 'mode', mode: 'horizontal' })
    apply({ type: 'back' })
    expect(graphPresentation(current)).toMatchObject({
      mode: 'mindmap',
      focusId: 'visual',
      scene: { viewport: { x: -3, y: 70, zoom: 0.95 } },
    })
    expect(current.selectedId).toBe('layout')
    apply({ type: 'global' })
    expect(graphPresentation(current)).toMatchObject({
      mode: 'horizontal',
      focusId: undefined,
      scene: { viewport: original, positions: { visual: { x: 132, y: 76 } } },
    })
    expect(current.selectedId).toBe('visual')
    expect(current.readers).toEqual(view().readers)
  })
  it('在聚焦中定位其他方向会恢复全图，并保留返回路径', () => {
    let current = {
      ...view(),
      ...transitionView(seed.nodes, view(), { type: 'focus', nodeId: 'visual' }),
    }
    current = {
      ...current,
      ...transitionView(seed.nodes, current, { type: 'select', nodeId: 'budget' }),
    }
    expect(current.selectedId).toBe('budget')
    expect(current.graph?.focusId).toBeUndefined()
    current = { ...current, ...transitionView(seed.nodes, current, { type: 'back' }) }
    expect(current.graph?.focusId).toBe('visual')
    expect(current.selectedId).toBe('visual')
  })
  it('每种表达、节点信息量和分支的视角分别保存', () => {
    let current = view()
    const apply = (action: Parameters<typeof transitionView>[2]) => {
      current = { ...current, ...transitionView(seed.nodes, current, action) }
    }
    apply({ type: 'scene', patch: { viewport: { x: 1, y: 2, zoom: 0.9 } } })
    apply({ type: 'detail', detail: 'compact' })
    expect(graphPresentation(current).scene.viewport).toBeUndefined()
    apply({ type: 'scene', patch: { viewport: { x: 3, y: 4, zoom: 0.7 } } })
    apply({ type: 'mode', mode: 'mindmap' })
    apply({ type: 'scene', patch: { viewport: { x: 5, y: 6, zoom: 0.6 } } })
    apply({ type: 'mode', mode: 'horizontal' })
    expect(graphPresentation(current).scene.viewport?.zoom).toBe(0.7)
    apply({ type: 'detail', detail: 'summary' })
    expect(graphPresentation(current).scene.viewport?.zoom).toBe(0.9)
    apply({ type: 'detail', detail: 'compact' })
    apply({ type: 'mode', mode: 'mindmap' })
    expect(graphPresentation(current).scene.viewport).toEqual({ x: 5, y: 6, zoom: 0.6 })
  })
  it('图谱遍历遵循研究身份、父子顺序和折叠范围', () => {
    const before = structuredClone(seed.nodes)
    expect(scopedResearch(seed.nodes, 'visual').map((node) => node.id)).toEqual([
      'visual',
      'layout',
      'progress',
    ])
    expect(
      visibleResearchRows(seed.nodes, ['visual']).some((row) => row.node.id === 'layout'),
    ).toBe(false)
    expect(visibleResearchRows(seed.nodes, ['root'], 'visual').map((row) => row.node.id)).toEqual([
      'visual',
      'layout',
      'progress',
    ])
    expect(seed.nodes).toEqual(before)
  })
})

describe('同一研究数据的中心式表达', () => {
  for (const detail of ['summary', 'compact'] as const)
    it(`${detail} 节点两侧不重叠，折叠不会交换分支左右`, () => {
      const before = structuredClone(seed.nodes),
        laid = layoutGraph(seed.nodes, [], undefined, { mode: 'mindmap', detail }),
        collapsed = layoutGraph(seed.nodes, ['visual'], undefined, { mode: 'mindmap', detail }),
        root = laid.find((item) => item.node.id === 'root')!
      expect(laid.some((item) => item.position.x < root.position.x)).toBe(true)
      expect(laid.some((item) => item.position.x > root.position.x)).toBe(true)
      for (const a of laid)
        for (const b of laid)
          if (a.node.id !== b.node.id)
            expect(
              Math.abs(a.position.x - b.position.x) < CARD_WIDTH &&
                Math.abs(a.position.y - b.position.y) < a.height,
            ).toBe(false)
      expect(laid[0].height).toBe(detail === 'compact' ? COMPACT_CARD_HEIGHT : CARD_HEIGHT)
      for (const item of collapsed)
        expect(item.side).toBe(laid.find((node) => node.node.id === item.node.id)?.side)
      expect(seed.nodes).toEqual(before)
    })
})

describe('材料定位保留研究和版本归属', () => {
  it('能找到旧报告正文并返回确切报告，而非最新报告', () => {
    const data = snapshot(),
      report = data.reports.find((report) => report.nodeId === 'visual')!
    report.markdown += '\n\n旧版材料唯一段落。'
    data.reports.push({
      ...report,
      id: 'new-report',
      markdown: '新版没有旧段落',
      createdAt: '2026-10-21T00:00:00Z',
    })
    expect(searchResearch(data, data.workspaces[0].id, '旧版材料', 'report')).toMatchObject([
      { kind: 'report', nodeId: 'visual', reportId: report.id, label: '报告 · v1' },
    ])
  })
  it('来源摘录指向所属报告版本与节点，不会串到其他空间', () => {
    const data = snapshot(),
      report = data.reports[0]
    report.sources = [
      {
        id: 'reference',
        title: '具体材料',
        url: 'https://example.com/local',
        excerpt: '隔离的来源摘录',
      },
    ]
    data.reports.push({ ...report, id: 'foreign', workspaceId: 'other-space' })
    expect(searchResearch(data, data.workspaces[0].id, '来源摘录')).toMatchObject([
      { kind: 'source', reportId: report.id, sourceId: 'reference', nodeId: report.nodeId },
    ])
  })
  it('标题目录与报告搜索区分，搜索不写入研究关联或原文', () => {
    const data = snapshot(),
      before = structuredClone(data)
    expect(
      searchResearch(data, data.workspaces[0].id, '').every((hit) => hit.kind === 'node'),
    ).toBe(true)
    expect(searchResearch(data, data.workspaces[0].id, '', 'source')).toEqual([])
    searchResearch(data, data.workspaces[0].id, '研究')
    expect(data).toEqual(before)
  })
})
