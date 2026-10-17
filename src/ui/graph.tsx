import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Handle,
  Position,
  useReactFlow,
  useViewport,
  type NodeProps,
  type Node,
  type Edge,
} from '@xyflow/react'
import { layoutGraph, CARD_WIDTH, CARD_HEIGHT } from './layout'
import {
  Plus,
  Minus,
  Scan,
  Focus,
  ChevronRight,
  ChevronDown,
  FileText,
  Circle,
  LoaderCircle,
  LayoutGrid,
  CornerDownRight,
} from 'lucide-react'
import type { ResearchNode } from '../research/types'
import { useApp } from './state'
import { ancestorPath } from '../research/context'
import { nodeStatus } from './components'

type CardData = {
  node: ResearchNode
  status: { key: string; label: string }
  count: number
  reports: number
  collapsed: boolean
  selectedPath: boolean
}
type FlowNode = Node<CardData, 'research'>
const ResearchCard = memo(function ResearchCard({ data, selected }: NodeProps<FlowNode>) {
  const { node, status, count, reports, collapsed } = data,
    { zoom } = useViewport()
  return (
    <div
      className={`research-card ${selected ? 'is-selected' : ''} ${status.key} ${zoom < 0.56 ? 'compact' : ''}`}
      style={{ '--branch': node.color } as React.CSSProperties}
      data-testid={`node-${node.id}`}
      title={node.question}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="card-top">
        <span className={`status ${status.key}`}>
          {status.key === 'running' ? (
            <LoaderCircle size={11} className="spin" />
          ) : (
            <span className="status-dot" />
          )}
          {status.label}
        </span>
        {node.parentId === null ? (
          <span className="root-tag">根问题</span>
        ) : (
          <span className="card-more">
            {reports > 0 && (
              <>
                <FileText size={11} />
                {reports}
              </>
            )}
          </span>
        )}
      </div>
      <h3>{node.title}</h3>
      <p>{node.summary || '一个值得深入的新方向，等待你开始探索。'}</p>
      <div className="card-footer">
        <span>
          {node.openQuestions.length > 0 ? (
            <>{node.openQuestions.length} 个未解问题</>
          ) : reports ? (
            '阶段认识已保存'
          ) : (
            '尚未形成报告'
          )}
        </span>
        <div className="card-actions">
          <button
            className="nodrag nopan"
            title="从此处添加研究方向"
            aria-label={`为${node.title}添加方向`}
            onClick={(event) => {
              event.stopPropagation()
              useApp.getState().select(node.id)
              useApp.getState().open('node')
            }}
          >
            <Plus size={13} />
          </button>
          {count > 0 && (
            <button
              className="nodrag nopan branch-toggle"
              aria-label={collapsed ? '展开子研究' : '收起子研究'}
              onClick={(event) => {
                event.stopPropagation()
                const state = useApp.getState(),
                  view = state.view!
                state.setView({
                  collapsed: collapsed
                    ? view.collapsed.filter((id) => id !== node.id)
                    : [...view.collapsed, node.id],
                })
                const path = ancestorPath(state.snapshot!.nodes, view.selectedId)
                if (!collapsed && path.some((n) => n.id === node.id)) state.select(node.id)
              }}
            >
              {count}
              {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </button>
          )}
        </div>
      </div>
    </div>
  )
})
const nodeTypes = { research: ResearchCard }

function GraphContent() {
  const snapshot = useApp((s) => s.snapshot)!,
    workspaceId = useApp((s) => s.workspaceId),
    view = useApp((s) => s.view)!,
    select = useApp((s) => s.select),
    setView = useApp((s) => s.setView)
  const flow = useReactFlow<FlowNode>(),
    container = useRef<HTMLDivElement>(null),
    previous = useRef<{ key: string; positions: Map<string, { x: number; y: number }> } | null>(
      null,
    )
  const [dragged, setDragged] = useState<Record<string, { x: number; y: number }>>({})
  const previousSelection = useRef(view.selectedId)
  const allNodes = snapshot.nodes.filter((n) => n.workspaceId === workspaceId),
    structure = allNodes.map((n) => n.id + ':' + n.parentId).join('|'),
    collapsedKey = view.collapsed.join('|')
  const laidOut = useMemo(
    () => layoutGraph(allNodes, view.collapsed, view.positions),
    [structure, collapsedKey, view.positions],
  )
  const path = new Set(ancestorPath(allNodes, view.selectedId).map((n) => n.id))
  const nodes: FlowNode[] = laidOut.map(({ node, position, count, collapsed }) => ({
    id: node.id,
    type: 'research',
    position: dragged[node.id] ?? position,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    selected: node.id === view.selectedId,
    data: {
      node,
      status: nodeStatus(node, snapshot),
      count,
      reports: snapshot.reports.filter((r) => r.nodeId === node.id).length,
      collapsed,
      selectedPath: path.has(node.id),
    },
    style: { opacity: 1 },
    ariaLabel: `${node.title}，${nodeStatus(node, snapshot).label}`,
  }))
  const visibleIds = new Set(nodes.map((n) => n.id)),
    edges: Edge[] = allNodes
      .filter((n) => n.parentId && visibleIds.has(n.id) && visibleIds.has(n.parentId))
      .map((n) => ({
        id: `${n.parentId}-${n.id}`,
        source: n.parentId!,
        target: n.id,
        type: 'default',
        style: {
          stroke: path.has(n.id) ? n.color : '#cbd2ca',
          strokeWidth: path.has(n.id) ? 2 : 1.3,
          opacity: path.has(n.id) ? 1 : 0.75,
        },
      }))
  const related = allNodes.find((n) => n.id === view.selectedId)?.relatedIds ?? []
  for (const target of related)
    if (visibleIds.has(target))
      edges.push({
        id: `related-${view.selectedId}-${target}`,
        source: view.selectedId,
        target,
        type: 'default',
        style: { stroke: '#a5aeb9', strokeDasharray: '5 5', strokeWidth: 1.3 },
        label: '相关研究',
        labelStyle: { fontSize: 10, fill: '#7a8590' },
        labelBgStyle: { fill: '#f6f7f3' },
      })
  const key = structure + '|' + collapsedKey
  useLayoutEffect(() => {
    const positions = new Map(laidOut.map((n) => [n.node.id, n.position])),
      old = previous.current
    if (old && old.key !== key) {
      const before = old.positions.get(view.selectedId),
        after = positions.get(view.selectedId)
      if (before && after) {
        const v = flow.getViewport()
        void flow.setViewport({
          ...v,
          x: v.x + (before.x - after.x) * v.zoom,
          y: v.y + (before.y - after.y) * v.zoom,
        })
      }
    }
    previous.current = { key, positions }
  }, [key, laidOut])
  useEffect(() => {
    if (previousSelection.current === view.selectedId) return
    previousSelection.current = view.selectedId
    const n = flow.getNode(view.selectedId),
      rect = container.current?.getBoundingClientRect()
    if (!n || !rect) return
    const v = flow.getViewport(),
      x = (n.position.x + CARD_WIDTH / 2) * v.zoom + v.x,
      y = (n.position.y + CARD_HEIGHT / 2) * v.zoom + v.y
    if (x < 70 || x > rect.width - 70 || y < 100 || y > rect.height - 80)
      void flow.setCenter(n.position.x + CARD_WIDTH / 2, n.position.y + CARD_HEIGHT / 2, {
        zoom: v.zoom,
        duration: 250,
      })
  }, [view.selectedId])
  const ready = allNodes.filter((n) => snapshot.reports.some((r) => r.nodeId === n.id)).length
  return (
    <div ref={container} className="research-canvas">
      <div className="canvas-heading">
        <div className="eyebrow">
          RESEARCH MAP <span>/</span> 研究图谱
        </div>
        <h1>
          循着问题，向深处生长<span>。</span>
        </h1>
        <p>每一条分支，都是一条正在展开的思路。</p>
      </div>
      <ReactFlow<FlowNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesConnectable={false}
        nodesDraggable={true}
        elementsSelectable
        zoomOnDoubleClick={false}
        panOnScroll
        panOnDrag
        selectionOnDrag={false}
        minZoom={0.22}
        maxZoom={1.5}
        fitView={!view.viewport}
        defaultViewport={view.viewport}
        fitViewOptions={{ padding: 0.07, minZoom: 0.35, maxZoom: 0.95 }}
        onNodeClick={(_, node) => select(node.id)}
        onNodesChange={(changes) => {
          for (const change of changes) {
            if (change.type === 'select' && change.selected && change.id !== view.selectedId)
              select(change.id)
            if (change.type === 'position' && change.position) {
              setDragged((current) => ({ ...current, [change.id]: change.position! }))
              if (!change.dragging)
                setView({
                  positions: { ...useApp.getState().view!.positions, [change.id]: change.position },
                })
            }
          }
        }}
        onNodeDragStop={(_, node) => {
          setView({ positions: { ...view.positions, [node.id]: node.position } })
          setDragged({})
        }}
        onMoveEnd={(_, viewport) => setView({ viewport })}
        onInit={(instance) => {
          if (view.viewport) void instance.setViewport(view.viewport)
        }}
        deleteKeyCode={null}
        nodesFocusable
        edgesFocusable={false}
      >
        <Background color="#d2d9d0" gap={22} size={0.9} />
      </ReactFlow>
      <div className="canvas-location">
        <CornerDownRight size={13} />{' '}
        {ancestorPath(allNodes, view.selectedId)
          .map((n) => n.title)
          .join(' / ')}
      </div>
      <div className="canvas-controls">
        <button
          title="缩小"
          aria-label="缩小画布"
          onClick={() => void flow.zoomOut({ duration: 150 })}
        >
          <Minus size={16} />
        </button>
        <span>{Math.round(useViewport().zoom * 100)}%</span>
        <button
          title="放大"
          aria-label="放大画布"
          onClick={() => void flow.zoomIn({ duration: 150 })}
        >
          <Plus size={16} />
        </button>
        <i />
        <button
          title="查看全图"
          aria-label="查看全图"
          onClick={() => void flow.fitView({ padding: 0.07, duration: 300, maxZoom: 1 })}
        >
          <Scan size={16} />
        </button>
        <button
          title="定位当前研究"
          aria-label="定位当前研究"
          onClick={() =>
            void flow.fitView({
              nodes: [{ id: view.selectedId }],
              padding: 1.1,
              maxZoom: 1,
              duration: 250,
            })
          }
        >
          <Focus size={16} />
        </button>
        <button
          title="恢复自动布局"
          aria-label="恢复自动布局"
          onClick={() => setView({ positions: {} })}
        >
          <LayoutGrid size={16} />
        </button>
      </div>
      <div className="canvas-legend">
        <span>
          <i className="legend-dot ready" />
          {ready} 已有认识
        </span>
        <span>
          <Circle size={8} />
          {allNodes.length - ready} 待深入
        </span>
      </div>
    </div>
  )
}
export function ResearchGraph() {
  const workspaceId = useApp((s) => s.workspaceId)
  return (
    <ReactFlowProvider key={workspaceId}>
      <GraphContent />
    </ReactFlowProvider>
  )
}
