import { describe, expect, it } from 'vitest'
import { layoutGraph, CARD_WIDTH, CARD_HEIGHT } from '../src/ui/layout'
import { starterResearch } from '../src/research/seed'
import type { ResearchNode } from '../src/research/types'

describe('研究画布布局', () => {
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
            overlapY = Math.abs(a.position.y - b.position.y) < CARD_HEIGHT
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
})
