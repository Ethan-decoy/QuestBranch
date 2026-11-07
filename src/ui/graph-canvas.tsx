import { statusText } from './i18n-labels'
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import {
  ReactFlow,
  Background,
  Handle,
  Position,
  BaseEdge,
  getBezierPath,
  useReactFlow,
  useViewport,
  type Node,
  type NodeProps,
  type EdgeProps,
  type Edge,
} from '@xyflow/react'
import { ChevronRight, CirclePause, Layers3, Sparkles } from 'lucide-react'
import type { GraphScene } from '../research/types'
import { ancestorPath } from '../research/context'
import { useApp } from './state'
import { nodeStatus, StatusLabel } from './components'
import { useTheme } from './theme'
import { displayBranchColor } from './theme-colors'
import { CARD_WIDTH, layoutGraph, mindmapSidePreferences } from './layout'
import { graphPresentation, relatedResearch } from './research-view'
import { handleGraphKey, toggleBranch } from './graph-navigation'
import {
  graphSignals,
  graphRegions,
  unseenGraphNodes,
  freshBranchCounts,
  readableViewport,
  newDirectionsViewport,
  type DrawnResearch,
} from './graph-visuals'
import { useAnimatedGraph, useReducedGraphMotion } from './graph-animation'
import { useTranslation } from 'react-i18next'

type CardData = {
  [key: string]: unknown
  item: DrawnResearch
  status: ReturnType<typeof nodeStatus>
  warm: boolean
  materialBelow: number
  running: boolean
  runningBelow: number
  waiting: boolean
  waitingBelow: number
  fresh: number
  concise: boolean
  human: boolean
}
export type ResearchFlowNode = Node<CardData, 'research'>
const ResearchCard = memo(function ResearchCard({ data, selected }: NodeProps<ResearchFlowNode>) {
  const { t } = useTranslation()
  const { item, status, running, runningBelow, waiting, waitingBelow, materialBelow, fresh } = data,
    { node, count, collapsed } = item
  const { zoom } = useViewport()
  return (
    <div
      className={`research-card ${status.key} ${selected ? 'is-selected' : ''} ${data.warm ? 'branch-warm' : ''} ${data.concise ? 'is-concise' : ''} ${fresh ? 'is-new' : ''} ${running ? 'ai-active' : ''} ${zoom < 0.56 ? 'compact' : ''} ${data.human ? 'on-human-path' : ''} ${item.depth > 1 ? 'deep-research' : ''} ${count ? 'has-children' : 'leaf'}`}
      style={{ height: item.height }}
      data-testid={`node-${node.id}`}
      aria-current={selected ? 'true' : undefined}
      title={node.question}
    >
      <Handle id="in-left" type="target" position={Position.Left} />
      <Handle id="in-right" type="target" position={Position.Right} />
      <Handle id="out-left" type="source" position={Position.Left} />
      <Handle id="out-right" type="source" position={Position.Right} />
      <div className="card-top">
        <StatusLabel status={status} />
        <span className="card-labels">
          {fresh > 0 && (
            <span className="graph-new-badge" title={t('{{fresh}} 个新增方向尚未查看', { fresh })}>
              {t('新 {{fresh}}', { fresh })}
            </span>
          )}
          {(running || runningBelow > 0) && (
            <span
              className="graph-ai-signal"
              title={
                running
                  ? t('AI 正在此研究工作')
                  : t('下方 {{runningBelow}} 项研究正在运行', { runningBelow })
              }
            >
              <Sparkles size={10} />
              <span className="research-thinking-sheen">
                {running ? t('研究中') : t('{{runningBelow}} 项运行', { runningBelow })}
              </span>
            </span>
          )}
          {(waiting || waitingBelow > 0) && (
            <span
              className="graph-waiting-signal"
              title={
                waiting
                  ? t('AI 正等待你回应')
                  : t('下方 {{waitingBelow}} 项研究等待回应', { waitingBelow })
              }
            >
              <CirclePause size={10} />
              {waiting ? t('待回应') : t('{{waitingBelow}} 项待回应', { waitingBelow })}
            </span>
          )}
          {selected && <span className="graph-reading-dot" title={t('当前阅读')} />}
        </span>
      </div>
      <h3 className={running ? 'research-thinking-sheen' : undefined}>{node.title}</h3>
      {!data.concise && item.depth <= 1 && <p>{node.summary}</p>}
      <div className="card-footer">
        <span>
          {collapsed && materialBelow > 0 ? (
            <>
              <Layers3 size={11} />
              {t('下方 {{materialBelow}} 项有积累', { materialBelow })}
            </>
          ) : !node.parentId ? (
            t('根问题')
          ) : null}
        </span>
        {count > 0 && zoom >= 0.6 && (
          <button
            className="nodrag nopan branch-toggle"
            aria-expanded={!collapsed}
            aria-label={
              selected
                ? collapsed
                  ? t('展开当前分支')
                  : t('收起当前分支')
                : collapsed
                  ? t('展开子研究')
                  : t('收起子研究')
            }
            title={
              collapsed
                ? t('展开 {{count}} 个子方向', { count })
                : t('收起 {{count}} 个子方向', { count })
            }
            onClick={(event) => {
              event.stopPropagation()
              toggleBranch(node.id)
            }}
          >
            {count}
            <ChevronRight size={12} />
          </button>
        )}
      </div>
    </div>
  )
})
function ResearchRegion({ data }: NodeProps) {
  return <div className="research-region" data-region-root={String(data.rootId)} />
}
function ResearchEdge(props: EdgeProps) {
  const [path] = getBezierPath(props),
    data = props.data as {
      human: boolean
      warm: boolean
      discussed: boolean
      opacity: number
      color: string
      depth: number
    }
  return (
    <g style={{ opacity: data.opacity }}>
      <BaseEdge
        path={path}
        style={{
          stroke: data.human ? 'var(--color-action)' : data.warm ? data.color : 'var(--color-edge)',
          strokeWidth: data.human ? 2 : data.warm ? 1.6 : 1.1,
          opacity: data.human ? 0.65 : data.warm ? 0.78 : 0.45,
          strokeDasharray: data.discussed && !data.human ? '3 5' : undefined,
        }}
      />
      {data.human && (
        <>
          <path
            d={path}
            pathLength="100"
            className="research-attention-glow"
            style={{ animationDelay: `${-data.depth * 0.24}s` }}
          />
          <path
            d={path}
            pathLength="100"
            className="research-attention-wave"
            style={{ animationDelay: `${-data.depth * 0.24}s` }}
          />
        </>
      )}
    </g>
  )
}
const nodeTypes = { research: ResearchCard, researchRegion: ResearchRegion },
  edgeTypes = { research: ResearchEdge }
export type LocateRequest = { nodeId: string; serial: number; viewport?: GraphScene['viewport'] }

export function GraphContent({
  locateRequest,
  onLocated,
}: {
  locateRequest?: LocateRequest
  onLocated: () => void
}) {
  const { t } = useTranslation()
  const snapshot = useApp((s) => s.snapshot)!,
    view = useApp((s) => s.view)!,
    workspaceId = useApp((s) => s.workspaceId),
    select = useApp((s) => s.select),
    pane = useApp((s) => s.compactPane),
    full = useApp((s) => s.readingMode)
  const theme = useTheme((s) => s.theme),
    flow = useReactFlow(),
    reduced = useReducedGraphMotion(),
    { zoom } = useViewport()
  const container = useRef<HTMLDivElement>(null),
    { mode, detail, focusId, scene } = graphPresentation(view),
    sceneKey = JSON.stringify([mode, detail, focusId])
  const allNodes = snapshot.nodes.filter((n) => n.workspaceId === workspaceId && !n.removedAt)
  const structure = allNodes.map((n) => `${n.id}:${n.parentId}`).join('|'),
    titleKey = allNodes.map((n) => n.title).join('\0'),
    collapsedKey = view.collapsed.join('|')
  const laidOut = useMemo(
    () =>
      layoutGraph(allNodes, view.collapsed, scene.positions, {
        mode,
        detail,
        focusId,
        branchSides: mindmapSidePreferences(allNodes, view),
      }),
    [
      structure,
      titleKey,
      collapsedKey,
      scene.positions,
      mode,
      detail,
      focusId,
      view.graph?.branchSides,
    ],
  )
  const { drawn, animating, settleDraggedNode } = useAnimatedGraph(laidOut, allNodes, reduced)
  const signals = useMemo(
    () => graphSignals(allNodes, snapshot, view.selectedId),
    [structure, snapshot.reports, snapshot.runs, view.selectedId],
  )
  const fresh = unseenGraphNodes(allNodes, view),
    freshKey = [...fresh].join('|'),
    freshCounts = useMemo(() => freshBranchCounts(allNodes, fresh), [structure, freshKey])
  const [dragged, setDragged] = useState<Record<string, { x: number; y: number }>>({}),
    [moving, setMoving] = useState(false),
    [viewportTick, setViewportTick] = useState(0),
    [birth, setBirth] = useState(0)
  const painted = drawn.map((item) => ({
    ...item,
    position: dragged[item.node.id] ?? item.position,
  }))
  const byId = new Map(allNodes.map((n) => [n.id, n])),
    drawnById = new Map(painted.map((item) => [item.node.id, item]))
  const regions = graphRegions(painted)
  const nodes: Node[] = painted.map((item) => {
    const node = byId.get(item.node.id) ?? item.node,
      aggregate = signals.descendants.get(node.id),
      status = nodeStatus(node, snapshot)
    const stage: ReturnType<typeof nodeStatus> =
      status.key === 'running'
        ? signals.material.has(node.id)
          ? { key: 'ready', label: '已有研究记录' }
          : signals.discussed.has(node.id)
            ? { key: 'discussed', label: '已开展讨论' }
            : { key: 'pending', label: '待研究' }
        : status.key === 'pending' && signals.material.has(node.id)
          ? { key: 'ready', label: '已有研究记录' }
          : status
    return {
      id: node.id,
      type: 'research',
      position: item.position,
      width: CARD_WIDTH,
      height: item.height,
      measured: { width: CARD_WIDTH, height: item.height },
      selected: node.id === view.selectedId,
      handles: [
        {
          id: 'in-left',
          type: 'target',
          position: Position.Left,
          x: 0,
          y: item.height / 2,
          width: 1,
          height: 1,
        },
        {
          id: 'in-right',
          type: 'target',
          position: Position.Right,
          x: CARD_WIDTH,
          y: item.height / 2,
          width: 1,
          height: 1,
        },
        {
          id: 'out-left',
          type: 'source',
          position: Position.Left,
          x: 0,
          y: item.height / 2,
          width: 1,
          height: 1,
        },
        {
          id: 'out-right',
          type: 'source',
          position: Position.Right,
          x: CARD_WIDTH,
          y: item.height / 2,
          width: 1,
          height: 1,
        },
      ],
      data: {
        item: { ...item, node },
        status: stage,
        warm: signals.material.has(node.id) || !!aggregate?.material,
        materialBelow: aggregate?.material ?? 0,
        running: signals.running.has(node.id),
        runningBelow: item.collapsed ? (aggregate?.running ?? 0) : 0,
        waiting: signals.waiting.has(node.id),
        waitingBelow: item.collapsed ? (aggregate?.waiting ?? 0) : 0,
        fresh: freshCounts.get(node.id) ?? 0,
        concise: detail === 'compact',
        human: signals.path.has(node.id),
      },
      style: {
        '--branch': displayBranchColor(node.color, theme),
        opacity: item.opacity,
        pointerEvents: item.leaving ? 'none' : undefined,
      } as CSSProperties,
      ariaLabel: `${node.title}，${statusText(stage)}${signals.running.has(node.id) ? t('，AI 研究中') : signals.waiting.has(node.id) ? t('，等待回应') : ''}`,
    }
  })
  for (const region of regions)
    nodes.unshift({
      id: `region-${region.id}`,
      type: 'researchRegion',
      position: { x: region.x, y: region.y },
      width: region.width,
      height: region.height,
      measured: { width: region.width, height: region.height },
      data: { rootId: region.id },
      zIndex: -10,
      selectable: false,
      focusable: false,
      draggable: false,
      style: {
        '--branch': displayBranchColor(region.color, theme),
        pointerEvents: 'none',
      } as CSSProperties,
    })
  const handles = (source: string, target: string) =>
    drawnById.get(source)!.position.x <= drawnById.get(target)!.position.x
      ? { sourceHandle: 'out-right', targetHandle: 'in-left' }
      : { sourceHandle: 'out-left', targetHandle: 'in-right' }
  const edges: Edge[] = painted
    .filter((item) => item.node.parentId && drawnById.has(item.node.parentId))
    .map((item) => ({
      id: `${item.node.parentId}-${item.node.id}`,
      source: item.node.parentId!,
      target: item.node.id,
      type: 'research',
      ...handles(item.node.parentId!, item.node.id),
      data: {
        human: signals.path.has(item.node.id) && signals.path.has(item.node.parentId!),
        warm:
          signals.material.has(item.node.id) || !!signals.descendants.get(item.node.id)?.material,
        discussed: signals.discussed.has(item.node.id),
        opacity: Math.min(item.opacity, drawnById.get(item.node.parentId!)!.opacity),
        color: displayBranchColor(item.node.color, theme),
        depth: item.depth,
      },
    }))
  for (const target of relatedResearch(allNodes, view.selectedId))
    if (drawnById.has(target.id) && drawnById.has(view.selectedId))
      edges.push({
        id: `related-${view.selectedId}-${target.id}`,
        source: view.selectedId,
        target: target.id,
        ...handles(view.selectedId, target.id),
        type: 'default',
        style: { stroke: 'var(--color-edge)', strokeDasharray: '5 5', strokeWidth: 1.3 },
        label: '相关研究',
        labelStyle: { fontSize: 10, fill: 'var(--color-text-secondary)' },
        labelBgStyle: { fill: 'var(--color-surface)', fillOpacity: 1 },
      })

  const camera = useRef(false),
    generation = useRef(0),
    anchoring = useRef(false),
    activeScene = useRef<string | null>(null),
    animationActive = useRef(animating)
  animationActive.current = animating
  const initialViewport = useRef(scene.viewport ?? { x: 0, y: 0, zoom: 0.9 })
  const latestLayout = useRef(laidOut)
  latestLayout.current = laidOut
  const pendingBirth = useRef<{ parentId: string; ids: string[]; sceneKey: string } | null>(null),
    known = useRef(new Set(allNodes.map((n) => n.id)))
  const saveScene = (patch: Partial<Pick<GraphScene, 'viewport' | 'positions'>>) => {
    const state = useApp.getState(),
      current = state.view && graphPresentation(state.view)
    if (
      current &&
      current.mode === mode &&
      current.detail === detail &&
      current.focusId === focusId
    )
      state.navigateGraph({ type: 'scene', patch })
  }
  const moveCamera = (viewport: NonNullable<GraphScene['viewport']>, duration = 420) => {
    const token = ++generation.current
    camera.current = true
    void flow.setViewport(viewport, { duration: reduced ? 0 : duration }).then(() => {
      if (token === generation.current) {
        camera.current = false
        saveScene({ viewport: flow.getViewport() })
        setViewportTick((n) => n + 1)
      }
    })
  }
  const frameNodes = (ids: string[], duration = 420) => {
    const rect = container.current?.getBoundingClientRect()
    if (!rect) return
    const viewport = readableViewport(
      latestLayout.current.filter((item) => ids.includes(item.node.id)),
      rect,
      useApp.getState().view!.selectedId,
    )
    if (viewport) moveCamera(viewport, duration)
  }
  const frameRef = useRef(frameNodes)
  frameRef.current = frameNodes
  useEffect(
    () => () => {
      generation.current++
    },
    [],
  )
  useEffect(() => {
    if (view.graph?.noticedNodeIds !== undefined) return
    const state = useApp.getState()
    state.setView({ graph: { ...state.view!.graph, noticedNodeIds: allNodes.map((n) => n.id) } })
  }, [structure, view.graph?.noticedNodeIds])
  useEffect(() => {
    const added = allNodes.filter((n) => !known.current.has(n.id))
    known.current = new Set(allNodes.map((n) => n.id))
    if (!added.some((n) => n.parentId === view.selectedId)) return
    const ids = added
      .filter((n) => ancestorPath(allNodes, n.id).some((p) => p.id === view.selectedId))
      .map((n) => n.id)
    pendingBirth.current = { parentId: view.selectedId, ids, sceneKey }
    setBirth((n) => n + 1)
    if (view.collapsed.includes(view.selectedId)) {
      const state = useApp.getState()
      state.setView({ collapsed: state.view!.collapsed.filter((id) => id !== view.selectedId) })
    }
  }, [structure])
  useEffect(() => {
    if (mode !== 'mindmap') return
    const rootId = focusId ?? allNodes.find((n) => !n.parentId)?.id,
      assigned = Object.fromEntries(
        laidOut
          .filter((item) => item.node.parentId === rootId)
          .map((item) => [item.node.id, item.side]),
      )
    const state = useApp.getState(),
      saved = state.view!.graph?.branchSides
    if (Object.entries(assigned).some(([id, side]) => saved?.[id] !== side))
      state.setView({ graph: { ...state.view!.graph, branchSides: { ...saved, ...assigned } } })
  }, [mode, focusId, laidOut])
  useLayoutEffect(() => {
    const rect = container.current?.getBoundingClientRect()
    if (
      !flow.viewportInitialized ||
      !rect ||
      rect.width < 100 ||
      rect.height < 100 ||
      activeScene.current === sceneKey
    )
      return
    const wasInitialized = activeScene.current !== null
    activeScene.current = sceneKey
    if (scene.viewport) moveCamera(scene.viewport, wasInitialized ? 420 : 0)
    else
      frameRef.current(
        [
          view.selectedId,
          ...allNodes.filter((n) => n.parentId === view.selectedId).map((n) => n.id),
        ],
        wasInitialized ? 420 : 0,
      )
  }, [sceneKey, flow.viewportInitialized, pane, full])
  const previousPositions = useRef<{
    sceneKey: string
    selectedId: string
    position: { x: number; y: number } | undefined
  }>({ sceneKey, selectedId: view.selectedId, position: undefined })
  useLayoutEffect(() => {
    const next = drawnById.get(view.selectedId)?.position,
      old = previousPositions.current
    if (
      next &&
      old.position &&
      old.sceneKey === sceneKey &&
      old.selectedId === view.selectedId &&
      !camera.current &&
      !Object.keys(dragged).length
    ) {
      const dx = old.position.x - next.x,
        dy = old.position.y - next.y
      if (dx || dy) {
        const v = flow.getViewport()
        anchoring.current = true
        void flow.setViewport({ ...v, x: v.x + dx * v.zoom, y: v.y + dy * v.zoom }).then(() => {
          anchoring.current = false
          if (!animationActive.current) saveScene({ viewport: flow.getViewport() })
        })
      }
    }
    previousPositions.current = { sceneKey, selectedId: view.selectedId, position: next }
  }, [drawn, view.selectedId, sceneKey, dragged])
  useEffect(() => {
    const pending = pendingBirth.current,
      rect = container.current?.getBoundingClientRect()
    if (!pending || animating || !rect?.width || !rect.height) return
    if (pending.sceneKey !== sceneKey || pending.parentId !== view.selectedId) {
      pendingBirth.current = null
      return
    }
    pendingBirth.current = null
    const target = newDirectionsViewport(latestLayout.current, rect, pending.parentId, pending.ids)
    if (target) moveCamera(target)
  }, [birth, animating, pane, full, view.selectedId, sceneKey])
  useEffect(() => {
    if (!flow.viewportInitialized || animating || !locateRequest) return
    const rect = container.current?.getBoundingClientRect()
    if (!rect?.width || !rect.height) return
    if (locateRequest.viewport) moveCamera(locateRequest.viewport)
    else frameRef.current([locateRequest.nodeId])
    onLocated()
  }, [flow.viewportInitialized, locateRequest?.serial, animating, pane, full])
  useEffect(() => {
    if (!flow.viewportInitialized || locateRequest || pendingBirth.current) return
    const timer = requestAnimationFrame(() => {
      const item = latestLayout.current.find((item) => item.node.id === view.selectedId),
        rect = container.current?.getBoundingClientRect(),
        v = flow.getViewport()
      if (!item || !rect?.width || !rect.height) return
      const x = (item.position.x + CARD_WIDTH / 2) * v.zoom + v.x,
        y = (item.position.y + item.height / 2) * v.zoom + v.y
      if (v.zoom < 0.88 || x < 40 || x > rect.width - 40 || y < 40 || y > rect.height - 40)
        frameRef.current([view.selectedId])
    })
    return () => cancelAnimationFrame(timer)
  }, [view.selectedId, pane, full])
  useEffect(() => {
    if (!fresh.size || animating || moving || camera.current) return
    const timer = setTimeout(() => {
      const rect = container.current?.getBoundingClientRect(),
        viewport = flow.getViewport()
      if (!rect?.width || !rect.height || camera.current) return
      const seen = latestLayout.current
        .filter(
          (item) =>
            fresh.has(item.node.id) &&
            item.position.x * viewport.zoom + viewport.x >= 8 &&
            (item.position.x + CARD_WIDTH) * viewport.zoom + viewport.x <= rect.width - 8 &&
            item.position.y * viewport.zoom + viewport.y >= 8 &&
            (item.position.y + item.height) * viewport.zoom + viewport.y <= rect.height - 8,
        )
        .map((item) => item.node.id)
      if (seen.length) {
        const state = useApp.getState()
        state.setView({
          graph: {
            ...state.view!.graph,
            noticedNodeIds: [...new Set([...(state.view!.graph?.noticedNodeIds ?? []), ...seen])],
          },
        })
      }
    }, 1800)
    return () => clearTimeout(timer)
  }, [freshKey, animating, moving, viewportTick, pane, full])
  return (
    <div
      ref={container}
      className={`flow-surface ${reduced ? 'graph-reduced-motion' : ''}`}
      onKeyDownCapture={(event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>(
          '.react-flow__node-research',
        )
        if (target?.dataset.id) handleGraphKey(event, target.dataset.id)
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesConnectable={false}
        nodesDraggable
        elementsSelectable
        panOnScroll
        panOnDrag
        zoomOnDoubleClick={false}
        selectionOnDrag={false}
        minZoom={0.001}
        maxZoom={1.5}
        fitView={false}
        defaultViewport={initialViewport.current}
        onNodeClick={(_, node) => {
          if (node.type === 'research') select(node.id, { showDetails: false })
        }}
        onNodeDoubleClick={(_, node) => {
          if (node.type === 'research') useApp.getState().setReadingMode(true)
        }}
        onNodeDrag={(_, node) => {
          pendingBirth.current = null
          setDragged((current) => ({ ...current, [node.id]: node.position }))
        }}
        onNodeDragStop={(_, node) => {
          settleDraggedNode(node.id, node.position)
          saveScene({
            positions: {
              ...graphPresentation(useApp.getState().view!).scene.positions,
              [node.id]: node.position,
            },
          })
          setDragged({})
        }}
        onMoveStart={(event) => {
          setMoving(true)
          if (event) {
            generation.current++
            camera.current = false
            pendingBirth.current = null
          }
        }}
        onMoveEnd={(_, viewport) => {
          setMoving(false)
          setViewportTick((n) => n + 1)
          if (!camera.current && !anchoring.current && !animationActive.current)
            saveScene({ viewport })
        }}
        deleteKeyCode={null}
        nodesFocusable={zoom >= 0.6}
        edgesFocusable={false}
        ariaLabelConfig={{
          'node.a11yDescription.default': t(
            '方向键浏览研究，Enter 阅读，Ctrl+Enter 添加子方向，Shift+Enter 添加同级方向，F2 编辑，空格折叠，Tab 切换控件。',
          ),
        }}
      >
        <Background color="var(--color-grid)" gap={24} size={0.7} />
      </ReactFlow>
    </div>
  )
}
