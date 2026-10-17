import dagre from '@dagrejs/dagre'
import type { ResearchNode } from '../research/types'
export const CARD_WIDTH = 224,
  CARD_HEIGHT = 156

export function layoutGraph(
  nodes: ResearchNode[],
  collapsed: string[],
  positions?: Record<string, { x: number; y: number }>,
) {
  const children = new Map<string, ResearchNode[]>(),
    byId = new Map(nodes.map((n) => [n.id, n])),
    hidden = new Set<string>(),
    folded = new Set(collapsed)
  for (const n of nodes)
    if (n.parentId) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n])
  const hide = (id: string) => {
    const queue = [...(children.get(id) ?? [])]
    while (queue.length) {
      const node = queue.pop()!
      if (hidden.has(node.id)) continue
      hidden.add(node.id)
      queue.push(...(children.get(node.id) ?? []))
    }
  }
  for (const id of collapsed) hide(id)
  const visible = nodes.filter((n) => !hidden.has(n.id)),
    graph = new dagre.graphlib.Graph()
  graph.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 48, marginx: 20, marginy: 20 })
  graph.setDefaultEdgeLabel(() => ({}))
  for (const n of [...visible].reverse())
    graph.setNode(n.id, { width: CARD_WIDTH, height: CARD_HEIGHT })
  for (const n of [...visible].reverse())
    if (n.parentId && byId.has(n.parentId) && !hidden.has(n.parentId))
      graph.setEdge(n.parentId, n.id)
  dagre.layout(graph)
  const laidOut = visible.map((n) => ({
    node: n,
    position: positions?.[n.id] ?? {
      x: graph.node(n.id).x - CARD_WIDTH / 2,
      y: graph.node(n.id).y - CARD_HEIGHT / 2,
    },
    count: children.get(n.id)?.length ?? 0,
    collapsed: folded.has(n.id),
  }))
  return laidOut
}
