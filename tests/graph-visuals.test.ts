import { describe, expect, it } from 'vitest'
import { starterResearch } from '../src/research/seed'
import type { ResearchNode, ResearchRun, ViewState } from '../src/research/types'
import { layoutGraph, CARD_WIDTH } from '../src/ui/layout'
import {
  freshBranchCounts,
  graphRegions,
  graphSignals,
  readableViewport,
  newDirectionsViewport,
  unseenGraphNodes,
} from '../src/ui/graph-visuals'

function run(nodeId: string, status: ResearchRun['status'], mode?: 'chat'): ResearchRun {
  return {
    id: `${nodeId}-${status}`,
    workspaceId: 'welcome-research',
    nodeId,
    instruction: '测试记录',
    status,
    mode,
    phase: '',
    output: '',
    error: '',
    model: 'fixture',
    createdAt: '2026-11-03T00:00:00Z',
    context: {
      policy: 'branch-v1',
      createdAt: '2026-11-03T00:00:00Z',
      workspaceId: 'welcome-research',
      nodeId,
      path: [],
      items: [],
      sources: [],
      messages: [],
      estimatedTokens: 0,
      budget: 1000,
      limitations: [],
    },
  }
}
describe('研究图的真实记录与视觉归属', () => {
  it('讨论、阶段材料、AI 活动与人的阅读路径相互独立，折叠汇总不冒充父研究', () => {
    const { nodes, reports } = starterResearch()
    const signals = graphSignals(
      nodes,
      {
        reports: [{ ...reports[0], nodeId: 'layout' }],
        runs: [
          run('progress', 'completed', 'chat'),
          run('budget', 'running', 'chat'),
          run('context', 'failed', 'chat'),
        ],
      },
      'visual',
    )
    expect(signals.material.has('layout')).toBe(true)
    expect(signals.material.has('progress')).toBe(false)
    expect(signals.discussed.has('progress')).toBe(true)
    expect(signals.running.has('budget')).toBe(true)
    expect(signals.running.has('context')).toBe(false)
    expect(signals.path.has('visual')).toBe(true)
    expect(signals.path.has('budget')).toBe(false)
    expect(signals.material.has('visual')).toBe(false)
    expect(signals.descendants.get('visual')?.material).toBe(1)
    expect(signals.descendants.get('context')?.running).toBe(1)
  })
  it('等待原生工具回应时保留等待标记，不能继续表示 AI 正在工作', () => {
    const { nodes } = starterResearch(),
      waiting = run('budget', 'running', 'chat')
    waiting.agent = {
      name: 'fixture',
      activities: [],
      requests: [
        {
          id: 'request',
          connectionId: 'fixture',
          kind: 'permission',
          title: '待回应',
          options: [],
          status: 'pending',
        },
      ],
    }
    const signals = graphSignals(nodes, { reports: [], runs: [waiting] }, 'visual')
    expect(signals.running.size).toBe(0)
    expect(signals.waiting.has('budget')).toBe(true)
    expect(signals.descendants.get('context')?.waiting).toBe(1)
    waiting.agent = { name: 'DSH', activities: [], requests: [], waitingForResponse: true }
    const host = graphSignals(nodes, { reports: [], runs: [waiting] }, 'visual')
    expect(host.waiting.has('budget')).toBe(true)
    expect(host.running.size).toBe(0)
  })
  it('历史工作区不把已有节点误报为新增，查看偏好可跨视图使用', () => {
    const { nodes } = starterResearch(),
      view: ViewState = { selectedId: 'root', collapsed: [], drafts: {} },
      existing = nodes.map((n) => n.id)
    expect(unseenGraphNodes(nodes, view).size).toBe(0)
    const next: ResearchNode[] = [
      ...nodes,
      { ...nodes[0], id: 'new-direction', parentId: 'visual' },
    ]
    const fresh = unseenGraphNodes(next, { ...view, graph: { noticedNodeIds: existing } })
    expect([...fresh]).toEqual(['new-direction'])
    expect(freshBranchCounts(next, fresh).get('visual')).toBe(1)
    expect(
      unseenGraphNodes(next, {
        ...view,
        graph: { mode: 'mindmap', noticedNodeIds: [...existing, 'new-direction'] },
      }).size,
    ).toBe(0)
  })
  it('深分支拆为同层区域，不重叠、不包含无关分支，浅层方向不被逐个套框', () => {
    const base = starterResearch().nodes[0],
      nodes: ResearchNode[] = [{ ...base, id: 'r', parentId: null }]
    for (let b = 0; b < 4; b++) {
      nodes.push({ ...base, id: `b${b}`, parentId: 'r' })
      for (let c = 0; c < 3; c++) {
        nodes.push({ ...base, id: `b${b}-${c}`, parentId: `b${b}` })
        for (let d = 0; d < 3; d++)
          nodes.push({ ...base, id: `b${b}-${c}-${d}`, parentId: `b${b}-${c}` })
      }
    }
    for (const mode of ['horizontal', 'mindmap'] as const) {
      const laid = layoutGraph(nodes, [], undefined, { mode }).map((item) => ({
        ...item,
        opacity: 1,
      }))
      const regions = graphRegions(laid)
      expect(regions.length).toBeGreaterThan(4)
      expect(regions.every((region) => region.width < 800 && region.height < 800)).toBe(true)
      for (const a of regions)
        for (const b of regions)
          if (a !== b)
            expect(
              a.x < b.x + b.width &&
                a.x + a.width > b.x &&
                a.y < b.y + b.height &&
                a.y + a.height > b.y,
            ).toBe(false)
    }
    const shallow = nodes.filter((n) => !n.id.includes('-'))
    for (let i = 0; i < 10; i++) shallow.push({ ...base, id: `leaf${i}`, parentId: 'b0' })
    expect(
      graphRegions(layoutGraph(shallow, []).map((item) => ({ ...item, opacity: 1 }))).some(
        (region) => region.id === 'b0',
      ),
    ).toBe(true)
  })
  it('自动取景优先可读并保留当前问题，隐藏画布不写入无效视角', () => {
    const { nodes } = starterResearch(),
      laid = layoutGraph(nodes, [])
    const viewport = readableViewport(laid, { width: 640, height: 560 }, 'visual')!
    expect(viewport.zoom).toBeGreaterThanOrEqual(0.88)
    const node = laid.find((item) => item.node.id === 'visual')!
    const x = (node.position.x + CARD_WIDTH / 2) * viewport.zoom + viewport.x
    expect(Number.isFinite(x)).toBe(true)
    const base = nodes[0],
      chain = Array.from({ length: 8 }, (_, i) => ({
        ...base,
        id: `chain-${i}`,
        parentId: i ? `chain-${i - 1}` : null,
      }))
    const deep = layoutGraph(chain, []),
      camera = readableViewport(deep, { width: 640, height: 560 }, 'chain-0')!
    const root = deep[0]
    expect(root.position.x * camera.zoom + camera.x).toBeGreaterThanOrEqual(23)
    expect((root.position.x + CARD_WIDTH) * camera.zoom + camera.x).toBeLessThanOrEqual(617)
    expect(readableViewport(laid, { width: 0, height: 0 }, 'visual')).toBeNull()
  })
  it('已有大量旧方向时，新方向仍进入可读视野，研究焦点由调用者保持', () => {
    const base = starterResearch().nodes[0],
      nodes: ResearchNode[] = [
        { ...base, id: 'r', parentId: null },
        { ...base, id: 'p', parentId: 'r' },
      ]
    for (let i = 0; i < 24; i++)
      nodes.push({ ...base, id: `leaf-${i}`, parentId: 'p', title: `方向 ${i}` })
    const layout = layoutGraph(nodes, []),
      added = nodes.slice(-6).map((n) => n.id)
    const camera = newDirectionsViewport(layout, { width: 640, height: 614 }, 'p', added)!
    expect(camera.zoom).toBeGreaterThanOrEqual(0.88)
    const visible = layout.filter(
      (item) =>
        added.includes(item.node.id) &&
        item.position.y * camera.zoom + camera.y >= 0 &&
        (item.position.y + item.height) * camera.zoom + camera.y <= 614,
    )
    expect(visible.length).toBeGreaterThanOrEqual(4)
  })
})
