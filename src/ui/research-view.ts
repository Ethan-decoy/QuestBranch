import type { GraphDetail, GraphMode, GraphScene, ResearchNode, ViewState } from '../research/types'
import { ancestorPath } from '../research/context'

export function graphPresentation(view: ViewState) {
  const mode = view.graph?.mode ?? 'horizontal',
    detail = view.graph?.detail ?? 'summary',
    focusId = view.graph?.focusId,
    scene = view.graph?.scenes?.find(
      (scene) => scene.mode === mode && scene.detail === detail && scene.focusId === focusId,
    )
  return {
    mode,
    detail,
    focusId,
    scene: scene ?? {
      mode,
      detail,
      focusId,
      ...(mode === 'horizontal' && detail === 'summary' && !focusId
        ? { viewport: view.viewport, positions: view.positions }
        : {}),
    },
  }
}

export type ViewAction =
  | { type: 'mode'; mode: GraphMode }
  | { type: 'detail'; detail: GraphDetail }
  | { type: 'focus'; nodeId: string }
  | { type: 'back' }
  | { type: 'global' }
  | { type: 'select'; nodeId: string }
  | { type: 'related'; nodeId: string }
  | { type: 'scene'; patch: Partial<Pick<GraphScene, 'viewport' | 'positions'>> }

/** All navigation paths use the same visible scope and return history. Only ViewState changes. */
export function transitionView(
  nodes: ResearchNode[],
  view: ViewState,
  action: ViewAction,
): Partial<ViewState> {
  const presentation = graphPresentation(view),
    { mode, detail, focusId, scene } = presentation,
    graph = { ...view.graph },
    history = graph.history ?? [],
    frame = {
      mode,
      detail,
      focusId,
      selectedId: view.selectedId,
      collapsed: [...view.collapsed],
      viewport: scene.viewport,
    }
  if (action.type === 'mode') return { graph: { ...graph, mode: action.mode } }
  if (action.type === 'detail') return { graph: { ...graph, detail: action.detail } }
  if (action.type === 'scene') {
    const next = { ...scene, ...action.patch },
      scenes = (graph.scenes ?? []).filter(
        (item) => !(item.mode === mode && item.detail === detail && item.focusId === focusId),
      )
    return {
      graph: { ...graph, scenes: [...scenes.slice(-63), next] },
      ...(mode === 'horizontal' && detail === 'summary' && !focusId ? action.patch : {}),
    }
  }
  if (action.type === 'back' || action.type === 'global') {
    const previous = action.type === 'back' ? history.at(-1) : history.find((item) => !item.focusId)
    if (!previous) return { graph: { ...graph, focusId: undefined, history: [] } }
    return {
      selectedId: previous.selectedId,
      collapsed: (previous.collapsed ?? view.collapsed).filter(
        (id) =>
          !ancestorPath(nodes, previous.selectedId)
            .slice(0, -1)
            .some((node) => node.id === id),
      ),
      graph: {
        ...graph,
        mode: previous.mode,
        detail: previous.detail,
        focusId: previous.focusId,
        history: action.type === 'back' ? history.slice(0, -1) : [],
        ...(previous.viewport
          ? {
              scenes: [
                ...(graph.scenes ?? [])
                  .filter(
                    (item) =>
                      !(
                        item.mode === previous.mode &&
                        item.detail === previous.detail &&
                        item.focusId === previous.focusId
                      ),
                  )
                  .slice(-63),
                {
                  ...graphPresentation({
                    ...view,
                    graph: {
                      ...graph,
                      mode: previous.mode,
                      detail: previous.detail,
                      focusId: previous.focusId,
                    },
                  }).scene,
                  viewport: previous.viewport,
                },
              ],
            }
          : {}),
      },
    }
  }
  const target = nodes.find((node) => node.id === action.nodeId)
  if (!target) return {}
  if (
    action.type === 'related' &&
    !relatedResearch(nodes, view.selectedId).some((node) => node.id === target.id)
  )
    return {}
  const path = ancestorPath(nodes, target.id).map((node) => node.id),
    ancestors = path.slice(0, -1)
  if (action.type === 'focus') {
    if (target.id === focusId || !target.parentId) return {}
    return {
      selectedId: target.id,
      collapsed: view.collapsed.filter((id) => !path.includes(id)),
      graph: { ...graph, focusId: target.id, history: [...history.slice(-19), frame] },
    }
  }
  return {
    selectedId: target.id,
    collapsed: view.collapsed.filter((id) => !ancestors.includes(id)),
    ...(action.type === 'related' || (focusId && !path.includes(focusId))
      ? {
          graph: {
            ...graph,
            focusId: focusId && path.includes(focusId) ? focusId : undefined,
            history: [...history.slice(-19), frame],
          },
        }
      : {}),
  }
}

/** Incoming and outgoing links are discoverable; neither direction implies a claim type. */
export function relatedResearch(nodes: ResearchNode[], selectedId: string) {
  const selected = nodes.find((node) => node.id === selectedId)
  if (!selected) return []
  const ids = new Set(selected.relatedIds)
  return nodes.filter(
    (node) =>
      node.workspaceId === selected.workspaceId &&
      node.id !== selectedId &&
      (ids.has(node.id) || node.relatedIds.includes(selectedId)),
  )
}

export function scopedResearch(nodes: ResearchNode[], focusId?: string) {
  if (!focusId) return nodes
  const children = new Map<string, string[]>()
  for (const node of nodes)
    if (node.parentId)
      children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id])
  const ids = new Set<string>(),
    pending = [focusId]
  while (pending.length) {
    const id = pending.pop()!
    if (ids.has(id)) continue
    ids.add(id)
    pending.push(...(children.get(id) ?? []))
  }
  return nodes.filter((node) => ids.has(node.id))
}

export function visibleResearchRows(nodes: ResearchNode[], collapsed: string[], focusId?: string) {
  const scoped = scopedResearch(nodes, focusId),
    ids = new Set(scoped.map((node) => node.id)),
    children = new Map<string, ResearchNode[]>(),
    folded = new Set(collapsed),
    rows: { node: ResearchNode; depth: number; count: number }[] = []
  for (const node of scoped)
    if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node])
  const pending = scoped
    .filter((node) => !node.parentId || !ids.has(node.parentId))
    .reverse()
    .map((node) => ({ node, depth: 0 }))
  while (pending.length) {
    const row = pending.pop()!,
      branch = children.get(row.node.id) ?? []
    rows.push({ ...row, count: branch.length })
    if (!folded.has(row.node.id))
      pending.push(...[...branch].reverse().map((node) => ({ node, depth: row.depth + 1 })))
  }
  return rows
}
