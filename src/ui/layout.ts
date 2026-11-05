import dagre from '@dagrejs/dagre'
import type { GraphDetail, GraphMode, ResearchNode, ViewState } from '../research/types'
import { visibleResearchRows } from './research-view'
export const CARD_WIDTH = 224,
  CARD_HEIGHT = 128,
  COMPACT_CARD_HEIGHT = 100

export function cardTitleLines(title: string) {
  // Conservative glyph widths for a 14px title in the fixed card width. The
  // browser still wraps text; this only reserves bounded space for up to 3 lines.
  const units = Array.from(title).reduce(
    (sum, char) => sum + (char.codePointAt(0)! > 255 ? 1 : 0.6),
    0,
  )
  return Math.max(1, Math.min(3, Math.ceil(units / 13)))
}

export function mindmapSidePreferences(nodes: ResearchNode[], view: ViewState) {
  const saved = view.graph?.branchSides ?? {}
  const rootId = view.graph?.focusId ?? nodes.find((node) => !node.parentId)?.id
  const scenes =
    view.graph?.scenes?.filter(
      (scene) => scene.mode === 'mindmap' && scene.focusId === view.graph?.focusId,
    ) ?? []
  const legacy =
    scenes.find((scene) => scene.detail === (view.graph?.detail ?? 'summary')) ?? scenes[0]
  if (!legacy || !rootId) return saved
  const branches = nodes.filter((node) => node.parentId === rootId)
  // A partial cache from another focus must not erase an older global layout.
  // Once this root is initialized, new branches can use the remaining space.
  const initialized = branches.some((node) => saved[node.id])
  return {
    ...Object.fromEntries(
      nodes
        .filter((node) => node.parentId === rootId)
        .filter((node) => !initialized || legacy.positions?.[node.id])
        .map((node, index) => {
          const position = legacy.positions?.[node.id],
            rootX = legacy.positions?.[rootId]?.x ?? 0
          return [
            node.id,
            position
              ? position.x < rootX
                ? ('left' as const)
                : ('right' as const)
              : index % 2
                ? ('left' as const)
                : ('right' as const),
          ]
        }),
    ),
    ...saved,
  }
}

/** Full (not folded) branch spans decide the initial balance; saved sides win. */
export function mindmapBranchSides(
  nodes: ResearchNode[],
  rootId: string,
  saved: Record<string, 'left' | 'right'> = {},
) {
  const children = new Map<string, ResearchNode[]>()
  for (const node of nodes)
    if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node])
  const order: string[] = [],
    pending = [rootId],
    seen = new Set<string>()
  while (pending.length) {
    const id = pending.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    order.push(id)
    pending.push(...(children.get(id) ?? []).map((node) => node.id))
  }
  const spans = new Map<string, number>()
  for (const id of order.reverse()) {
    const branch = children.get(id) ?? []
    spans.set(
      id,
      Math.max(
        1,
        branch.reduce((sum, node) => sum + (spans.get(node.id) ?? 1), 0) +
          Math.max(0, branch.length - 1) / 6,
      ),
    )
  }
  const result: Record<string, 'left' | 'right'> = {},
    load = { left: 0, right: 0 },
    branches = children.get(rootId) ?? []
  for (const node of branches)
    if (saved[node.id]) {
      result[node.id] = saved[node.id]
      load[saved[node.id]] += spans.get(node.id) ?? 1
    }
  for (const node of [...branches]
    .filter((node) => !result[node.id])
    .sort((a, b) => (spans.get(b.id) ?? 1) - (spans.get(a.id) ?? 1))) {
    const side = load.right <= load.left ? 'right' : 'left'
    result[node.id] = side
    load[side] += spans.get(node.id) ?? 1
  }
  return result
}

export function layoutGraph(
  nodes: ResearchNode[],
  collapsed: string[],
  positions?: Record<string, { x: number; y: number }>,
  options: {
    mode?: GraphMode
    detail?: GraphDetail
    focusId?: string
    branchSides?: Record<string, 'left' | 'right'>
  } = {},
) {
  const rows = visibleResearchRows(nodes, collapsed, options.focusId),
    visible = rows.map((row) => row.node),
    heights = new Map(
      rows.map(({ node, depth, count }) => [
        node.id,
        options.detail === 'compact'
          ? COMPACT_CARD_HEIGHT + Math.max(0, cardTitleLines(node.title) - 2) * 20
          : (depth <= 1 ? CARD_HEIGHT : 84 + (count ? 24 : 0)) +
            Math.max(0, cardTitleLines(node.title) - (depth <= 1 ? 1 : 2)) * 22,
      ]),
    ),
    folded = new Set(collapsed),
    sides = new Map<string, 'left' | 'right'>(),
    root = visible[0]
  if (!root) return []
  function arrange(items: ResearchNode[]) {
    const graph = new dagre.graphlib.Graph(),
      ids = new Set(items.map((node) => node.id))
    graph.setGraph({ rankdir: 'LR', nodesep: 32, ranksep: 48, marginx: 20, marginy: 20 })
    graph.setDefaultEdgeLabel(() => ({}))
    for (const node of [...items].reverse())
      graph.setNode(node.id, { width: CARD_WIDTH, height: heights.get(node.id)! })
    for (const node of [...items].reverse())
      if (node.parentId && ids.has(node.parentId)) graph.setEdge(node.parentId, node.id)
    dagre.layout(graph)
    // Keep each actual subtree in its own vertical span. Dagre's compacting
    // alone can place an unrelated sibling inside another branch's region.
    const children = new Map<string, ResearchNode[]>()
    for (const node of items)
      if (node.parentId && ids.has(node.parentId))
        children.set(node.parentId, [...(children.get(node.parentId) ?? []), node])
    for (const parent of [...items].reverse()) {
      const branch = children.get(parent.id) ?? []
      if (!branch.length) continue
      let cursor = 0
      const gap = parent.id === root.id ? 56 : 32
      for (const child of branch) {
        const pending = [child],
          subtree: ResearchNode[] = []
        while (pending.length) {
          const node = pending.pop()!
          subtree.push(node)
          pending.push(...(children.get(node.id) ?? []))
        }
        const top = Math.min(
          ...subtree.map((node) => graph.node(node.id).y - heights.get(node.id)! / 2),
        )
        const bottom = Math.max(
          ...subtree.map((node) => graph.node(node.id).y + heights.get(node.id)! / 2),
        )
        for (const node of subtree) graph.node(node.id).y += cursor - top
        cursor += bottom - top + gap
      }
      graph.node(parent.id).y = (cursor - gap) / 2
    }
    return graph
  }
  const automatic = new Map<string, { x: number; y: number }>()
  if (options.mode === 'mindmap') {
    const assigned = mindmapBranchSides(nodes, root.id, options.branchSides)
    for (const [id, side] of Object.entries(assigned)) sides.set(id, side)
    for (const node of visible)
      if (node.parentId && node.parentId !== root.id)
        sides.set(node.id, sides.get(node.parentId) ?? 'right')
    automatic.set(root.id, { x: 0, y: 0 })
    for (const side of ['left', 'right'] as const) {
      const items = visible.filter((node) => node.id === root.id || sides.get(node.id) === side),
        graph = arrange(items),
        origin = graph.node(root.id)
      for (const node of items)
        if (node.id !== root.id)
          automatic.set(node.id, {
            x: (graph.node(node.id).x - origin.x) * (side === 'left' ? -1 : 1),
            y:
              graph.node(node.id).y -
              origin.y +
              (heights.get(root.id)! - heights.get(node.id)!) / 2,
          })
    }
  } else {
    const graph = arrange(visible)
    for (const node of visible)
      automatic.set(node.id, {
        x: graph.node(node.id).x - CARD_WIDTH / 2,
        y: graph.node(node.id).y - heights.get(node.id)! / 2,
      })
  }
  // A manual placement moves its automatic descendants together. Explicit
  // descendant placements still win, in parent-to-child order.
  for (const { node } of rows)
    if (positions?.[node.id]) {
      const before = automatic.get(node.id)!,
        after = positions[node.id]
      const branch = new Set([node.id])
      for (const row of rows)
        if (row.node.parentId && branch.has(row.node.parentId)) branch.add(row.node.id)
      for (const id of branch) {
        const point = automatic.get(id)!
        automatic.set(id, { x: point.x + after.x - before.x, y: point.y + after.y - before.y })
      }
    }
  // Automatic nodes yield to manual placements. Never silently relocate an
  // explicitly placed node, including two pins the user deliberately overlaps.
  const occupied: string[] = []
  for (const { node } of [...rows].sort(
    (a, b) => Number(!!positions?.[b.node.id]) - Number(!!positions?.[a.node.id]),
  )) {
    const point = automatic.get(node.id)!
    if (!positions?.[node.id])
      for (let attempt = 0; attempt < rows.length; attempt++) {
        const collisions = occupied.filter((id) => {
          const other = automatic.get(id)!
          return (
            point.x < other.x + CARD_WIDTH + 12 &&
            point.x + CARD_WIDTH + 12 > other.x &&
            point.y < other.y + heights.get(id)! + 16 &&
            point.y + heights.get(node.id)! + 16 > other.y
          )
        })
        if (!collisions.length) break
        point.y = Math.max(...collisions.map((id) => automatic.get(id)!.y + heights.get(id)!)) + 32
      }
    occupied.push(node.id)
  }
  return rows.map(({ node, count, depth }) => ({
    node,
    count,
    depth,
    height: heights.get(node.id)!,
    side: sides.get(node.id) ?? 'right',
    position: automatic.get(node.id)!,
    collapsed: folded.has(node.id),
  }))
}
