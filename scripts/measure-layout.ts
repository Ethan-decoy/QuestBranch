import { cpus } from 'node:os'
import { layoutGraph } from '../src/ui/layout'
import { starterResearch } from '../src/research/seed'
import type { ResearchNode } from '../src/research/types'

const base = starterResearch().nodes[0]
function measure(total: number, visible: number) {
  const nodes: ResearchNode[] = [{ ...base, id: 'measure-root', parentId: null }]
  for (let i = 1; i < total; i++)
    nodes.push({
      ...base,
      id: `node-${i}`,
      parentId:
        i < visible
          ? i <= 3
            ? 'measure-root'
            : `node-${Math.floor((i - 1) / 3)}`
          : `node-${67 + (i % 133)}`,
    })
  const collapsed = total === visible ? [] : nodes.slice(67, 200).map((n) => n.id)
  const durations: number[] = []
  for (let i = 0; i < 6; i++) {
    const start = performance.now(),
      result = layoutGraph(nodes, collapsed)
    if (result.length !== visible) throw new Error('可见节点数量不符')
    if (i > 0) durations.push(performance.now() - start)
  }
  durations.sort((a, b) => a - b)
  return {
    totalNodes: total,
    visibleNodes: visible,
    medianMs: Number(durations[2].toFixed(1)),
    maxMs: Number(durations.at(-1)!.toFixed(1)),
  }
}
console.log(
  JSON.stringify(
    {
      platform: process.platform,
      node: process.version,
      cpu: cpus()[0]?.model,
      meaning: '纯布局耗时，排除首轮，不表示画布帧率或拖动响应',
      measurements: [measure(200, 200), measure(2000, 200)],
    },
    null,
    2,
  ),
)
