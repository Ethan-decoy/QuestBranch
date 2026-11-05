import { describe, expect, it } from 'vitest'
import {
  layoutGraph,
  CARD_WIDTH,
  mindmapBranchSides,
  mindmapSidePreferences,
} from '../src/ui/layout'
import { starterResearch } from '../src/research/seed'
import type { ResearchNode } from '../src/research/types'

describe('研究画布布局', () => {
  it('长中文标题获得有限的额外高度，两种结构与密度均不重叠', () => {
    const nodes = starterResearch().nodes.map((node, index) => ({
      ...node,
      title:
        index % 2
          ? '如何在跨平台研究工作空间里保留重要问题的长期上下文并减少维护成本？'
          : node.title,
    }))
    for (const mode of ['horizontal', 'mindmap'] as const)
      for (const detail of ['summary', 'compact'] as const) {
        const laid = layoutGraph(nodes, [], undefined, { mode, detail })
        expect(laid.some((item) => item.height > (detail === 'summary' ? 144 : 100))).toBe(true)
        expect(Math.max(...laid.map((item) => item.height))).toBeLessThanOrEqual(
          detail === 'summary' ? 188 : 120,
        )
        for (const a of laid)
          for (const b of laid)
            if (a.node.id !== b.node.id) {
              const overlap =
                a.position.x < b.position.x + CARD_WIDTH &&
                a.position.x + CARD_WIDTH > b.position.x &&
                a.position.y < b.position.y + b.height &&
                a.position.y + a.height > b.position.y
              expect(overlap).toBe(false)
            }
      }
  })
  it('完整分支跨度平衡两侧，保存后折叠、密度和新增后代均不翻边', () => {
    const base = starterResearch().nodes[0],
      nodes: ResearchNode[] = [{ ...base, id: 'r', parentId: null }]
    for (let branch = 0; branch < 6; branch++) {
      nodes.push({ ...base, id: `b${branch}`, parentId: 'r' })
      for (let leaf = 0; leaf < (branch === 0 ? 18 : branch === 2 ? 16 : 1); leaf++)
        nodes.push({ ...base, id: `b${branch}-${leaf}`, parentId: `b${branch}` })
    }
    const sides = mindmapBranchSides(nodes, 'r')
    expect(sides.b0).not.toBe(sides.b2)
    const before = structuredClone(nodes)
    for (const detail of ['summary', 'compact'] as const) {
      const laid = layoutGraph(nodes, ['b0', 'b2'], undefined, {
        mode: 'mindmap',
        detail,
        branchSides: sides,
      })
      for (const item of laid.filter((item) => item.node.parentId === 'r'))
        expect(item.side).toBe(sides[item.node.id])
    }
    nodes.push(
      ...Array.from({ length: 30 }, (_, index) => ({
        ...base,
        id: `new-${index}`,
        parentId: 'b1',
      })),
    )
    expect(mindmapBranchSides(nodes, 'r', sides)).toEqual(sides)
    expect(before).toEqual(nodes.slice(0, before.length))
  })
  it('旧中心图保留交替分边和手动位置，新视图不强制替换旧偏好', () => {
    const { nodes } = starterResearch(),
      positions = { visual: { x: -800, y: 55 } },
      view = {
        selectedId: 'visual',
        collapsed: [],
        drafts: {},
        graph: {
          mode: 'mindmap' as const,
          scenes: [{ mode: 'mindmap' as const, detail: 'summary' as const, positions }],
        },
      },
      preferred = mindmapSidePreferences(nodes, view)
    expect(preferred.visual).toBe('left')
    expect(preferred.context).toBe('left')
    const restored = mindmapSidePreferences(nodes, {
      ...view,
      graph: {
        ...view.graph,
        branchSides: { layout: 'right' },
        detail: 'compact',
        scenes: [
          ...view.graph.scenes,
          { mode: 'mindmap', detail: 'compact', positions: { visual: { x: 500, y: 80 } } },
        ],
      },
    })
    expect(restored.visual).toBe('right')
    expect(restored.context).toBe('left')
    expect(restored.layout).toBe('right')
    expect(
      layoutGraph(nodes, [], positions, { mode: 'mindmap', branchSides: preferred }).find(
        (item) => item.node.id === 'visual',
      )?.position,
    ).toEqual(positions.visual)
  })
  it('分支顺序与导航一致，卡片不重叠', () => {
    const { nodes } = starterResearch(),
      laid = layoutGraph(nodes, []),
      visual = laid.find((n) => n.node.id === 'visual')!,
      context = laid.find((n) => n.node.id === 'context')!,
      local = laid.find((n) => n.node.id === 'local')!
    expect(visual.position.y).toBeLessThan(context.position.y)
    expect(context.position.y).toBeLessThan(local.position.y)
    for (const a of laid)
      for (const b of laid)
        if (a.node.id !== b.node.id) {
          const overlapX = Math.abs(a.position.x - b.position.x) < CARD_WIDTH,
            overlapY =
              a.position.y < b.position.y + b.height && a.position.y + a.height > b.position.y
          expect(overlapX && overlapY).toBe(false)
        }
  })
  it('折叠只隐藏后代，其他研究分支与手动位置保留', () => {
    const { nodes } = starterResearch(),
      laid = layoutGraph(nodes, ['visual'], { context: { x: 900, y: 1200 } })
    expect(laid.some((n) => n.node.id === 'layout')).toBe(false)
    expect(laid.some((n) => n.node.id === 'progress')).toBe(false)
    expect(laid.some((n) => n.node.id === 'budget')).toBe(true)
    expect(laid.find((n) => n.node.id === 'context')?.position).toEqual({ x: 900, y: 1200 })
    expect(laid.find((n) => n.node.id === 'visual')?.collapsed).toBe(true)
  })
  it('200 个可见节点与 2000 个总节点折叠场景可完成布局', () => {
    const base = starterResearch().nodes[0],
      nodes: ResearchNode[] = [{ ...base, id: 'scale-root', parentId: null }]
    for (let i = 1; i < 2000; i++)
      nodes.push({
        ...base,
        id: `scale-${i}`,
        parentId: i <= 199 ? 'scale-root' : `scale-${(i % 199) + 1}`,
        title: `研究问题 ${i}`,
      })
    const collapsed = nodes.slice(1, 200).map((n) => n.id),
      start = performance.now(),
      laid = layoutGraph(nodes, collapsed),
      elapsed = performance.now() - start
    expect(laid).toHaveLength(200)
    expect(laid.every((n) => Number.isFinite(n.position.x) && Number.isFinite(n.position.y))).toBe(
      true,
    )
    console.info(
      `布局测量：2000 总节点 / 200 可见节点，${elapsed.toFixed(1)} ms（单次 CPU 布局，非界面帧率）`,
    )
  })
  it('手动节点与新增分支同时存在时，自动节点让位且不覆盖手动位置', () => {
    const { nodes } = starterResearch()
    for (const mode of ['horizontal', 'mindmap'] as const) {
      const initial = layoutGraph(nodes, [], undefined, { mode })
      const pinned = initial.find((item) => item.node.id === 'layout')!
      const other = initial.find((item) => item.node.id === 'context')!
      const positions = { [pinned.node.id]: { ...other.position } }
      const next = layoutGraph(
        [
          ...nodes,
          { ...nodes[0], id: 'new-layout-question', parentId: 'visual', title: '新出现的研究问题' },
        ],
        [],
        positions,
        { mode },
      )
      expect(next.find((item) => item.node.id === pinned.node.id)!.position).toEqual(
        positions[pinned.node.id],
      )
      for (const a of next)
        for (const b of next)
          if (a.node.id !== b.node.id) {
            expect(
              a.position.x < b.position.x + CARD_WIDTH &&
                a.position.x + CARD_WIDTH > b.position.x &&
                a.position.y < b.position.y + b.height &&
                a.position.y + a.height > b.position.y,
            ).toBe(false)
          }
    }
  })
})
