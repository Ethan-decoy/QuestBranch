import type { ResearchNode, Snapshot, ViewState } from '../research/types'
import { ancestorPath } from '../research/context'
import type { layoutGraph } from './layout'
import { CARD_WIDTH } from './layout'

export type GraphLayout = ReturnType<typeof layoutGraph>
export type DrawnResearch = GraphLayout[number] & { opacity: number; leaving?: boolean }

/** Read real records once; a report is available material, never verified truth. */
export function graphSignals(
  nodes: ResearchNode[],
  snapshot: Pick<Snapshot, 'reports' | 'runs'>,
  selectedId: string,
) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const material = new Set(snapshot.reports.map((r) => r.nodeId))
  const discussed = new Set<string>(),
    running = new Set<string>(),
    waiting = new Set<string>()
  for (const run of snapshot.runs) {
    if (run.status === 'running') {
      if (run.agent?.requests.some((request) => request.status === 'pending'))
        waiting.add(run.nodeId)
      else running.add(run.nodeId)
    }
    if (run.status === 'completed') {
      if (run.mode === 'chat') discussed.add(run.nodeId)
      else material.add(run.nodeId)
    }
  }
  for (const id of waiting) running.delete(id)
  const descendants = new Map(nodes.map((n) => [n.id, { material: 0, running: 0, waiting: 0 }]))
  for (const n of nodes)
    if (material.has(n.id) || running.has(n.id) || waiting.has(n.id)) {
      const seen = new Set<string>([n.id])
      let parent = n.parentId
      while (parent && !seen.has(parent)) {
        seen.add(parent)
        const aggregate = descendants.get(parent)
        if (!aggregate) break
        aggregate.material += Number(material.has(n.id))
        aggregate.running += Number(running.has(n.id))
        aggregate.waiting += Number(waiting.has(n.id))
        parent = byId.get(parent)?.parentId ?? null
      }
    }
  return {
    material,
    discussed,
    running,
    waiting,
    descendants,
    path: new Set(ancestorPath(nodes, selectedId).map((n) => n.id)),
  }
}

/** Undefined means an existing workspace needs a quiet initial baseline. */
export function unseenGraphNodes(nodes: ResearchNode[], view: ViewState) {
  if (!view.graph?.noticedNodeIds) return new Set<string>()
  const noticed = new Set(view.graph.noticedNodeIds)
  return new Set(nodes.filter((n) => !n.removedAt && !noticed.has(n.id)).map((n) => n.id))
}

export function graphSubtrees(nodes: ResearchNode[]) {
  const children = new Map<string, string[]>()
  for (const node of nodes)
    if (node.parentId)
      children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id])
  const result = new Map<string, Set<string>>()
  function visit(id: string, visiting: Set<string>): Set<string> {
    if (result.has(id)) return result.get(id)!
    if (visiting.has(id)) return new Set()
    const seen = new Set([id]),
      next = new Set(visiting).add(id)
    for (const child of children.get(id) ?? [])
      for (const descendant of visit(child, next)) seen.add(descendant)
    result.set(id, seen)
    return seen
  }
  for (const node of nodes) visit(node.id, new Set())
  return result
}

/** Non-nested visual regions follow existing branches, never create new research groups. */
export function graphRegions(items: DrawnResearch[]) {
  const visible = items.filter((item) => !item.leaving),
    byId = new Map(visible.map((item) => [item.node.id, item]))
  const children = new Map<string, string[]>()
  for (const item of visible)
    if (item.node.parentId && byId.has(item.node.parentId))
      children.set(item.node.parentId, [...(children.get(item.node.parentId) ?? []), item.node.id])
  const scopes = graphSubtrees(visible.map((item) => item.node))
  const regions: {
    id: string
    familyId: string
    x: number
    y: number
    width: number
    height: number
  }[] = []
  function partition(id: string, familyId: string) {
    const scope = scopes.get(id)!,
      block = visible.filter((item) => scope.has(item.node.id))
    if (!block.length) return
    const x = Math.min(...block.map((item) => item.position.x)),
      y = Math.min(...block.map((item) => item.position.y))
    const width = Math.max(...block.map((item) => item.position.x + CARD_WIDTH)) - x
    const height = Math.max(...block.map((item) => item.position.y + item.height)) - y
    const next = children.get(id) ?? [],
      hasSubbranches = next.some((child) => children.has(child))
    if ((block.length > 8 || width > 760 || height > 720) && hasSubbranches) {
      for (const child of next) partition(child, familyId)
      return
    }
    const padding = id === familyId ? 14 : 10
    const region = {
      id,
      familyId,
      x: x - padding,
      y: y - padding,
      width: width + padding * 2,
      height: height + padding * 2,
    }
    // A manual placement may interleave unrelated branches. Keep the graph
    // truthful rather than painting a foreign node into this branch's area.
    if (
      visible.some(
        (item) =>
          !scope.has(item.node.id) &&
          item.position.x < region.x + region.width &&
          item.position.x + CARD_WIDTH > region.x &&
          item.position.y < region.y + region.height &&
          item.position.y + item.height > region.y,
      )
    )
      return
    if (
      regions.some(
        (other) =>
          region.x < other.x + other.width &&
          region.x + region.width > other.x &&
          region.y < other.y + other.height &&
          region.y + region.height > other.y,
      )
    )
      return
    regions.push(region)
  }
  const root = visible.find((item) => !item.node.parentId || !byId.has(item.node.parentId))
  if (root) for (const id of children.get(root.node.id) ?? []) partition(id, id)
  return regions
}

export function freshBranchCounts(nodes: ResearchNode[], fresh: Set<string>) {
  const parents = new Map(nodes.map((n) => [n.id, n.parentId])),
    counts = new Map<string, number>()
  for (const id of fresh) {
    const visited = new Set<string>()
    let cursor: string | null | undefined = id
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor)
      counts.set(cursor, (counts.get(cursor) ?? 0) + 1)
      cursor = parents.get(cursor)
    }
  }
  return counts
}

export function readableViewport(
  items: Pick<DrawnResearch, 'node' | 'position' | 'height'>[],
  size: { width: number; height: number },
  selectedId: string,
) {
  if (!items.length || size.width < 100 || size.height < 100) return null
  const x0 = Math.min(...items.map((item) => item.position.x)),
    y0 = Math.min(...items.map((item) => item.position.y))
  const x1 = Math.max(...items.map((item) => item.position.x + CARD_WIDTH)),
    y1 = Math.max(...items.map((item) => item.position.y + item.height))
  const zoom = Math.min(
    1,
    Math.max(0.88, Math.min((size.width - 64) / (x1 - x0), (size.height - 80) / (y1 - y0))),
  )
  const selected = items.find((item) => item.node.id === selectedId)
  const cy =
    selected && (y1 - y0) * zoom > size.height - 16
      ? selected.position.y + selected.height / 2
      : (y0 + y1) / 2
  let x = size.width / 2 - ((x0 + x1) / 2) * zoom
  if (selected) {
    const left = 24 - selected.position.x * zoom
    const right = size.width - 24 - (selected.position.x + CARD_WIDTH) * zoom
    if (left <= right) x = Math.min(right, Math.max(left, x))
  }
  return { zoom, x, y: size.height / 2 - cy * zoom }
}

/** Preserve the selected research in the reader; distant appended directions
 * get the canvas when parent and additions cannot share a readable viewport. */
export function newDirectionsViewport(
  items: GraphLayout,
  size: { width: number; height: number },
  parentId: string,
  ids: string[],
) {
  const added = new Set(ids),
    targets = items.filter((item) => item.node.id === parentId || added.has(item.node.id))
  const viewport = readableViewport(targets, size, parentId)
  if (!viewport) return null
  const readable = targets.filter(
    (item) =>
      added.has(item.node.id) &&
      item.position.x * viewport.zoom + viewport.x >= 0 &&
      (item.position.x + CARD_WIDTH) * viewport.zoom + viewport.x <= size.width &&
      item.position.y * viewport.zoom + viewport.y >= 0 &&
      (item.position.y + item.height) * viewport.zoom + viewport.y <= size.height,
  )
  return readable.length < ids.length
    ? readableViewport(
        targets.filter((item) => added.has(item.node.id)),
        size,
        '',
      )
    : viewport
}
