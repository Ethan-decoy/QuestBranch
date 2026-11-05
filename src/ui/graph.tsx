import { useRef, useState } from 'react'
import { ReactFlowProvider, useReactFlow, useViewport } from '@xyflow/react'
import { Plus, Minus, Scan, Focus, LayoutGrid, CornerDownRight } from 'lucide-react'
import { useApp } from './state'
import { CARD_WIDTH, mindmapBranchSides } from './layout'
import { graphPresentation, transitionView } from './research-view'
import { BranchTrail, GraphDock } from './graph-navigation'
import { RelatedResearch } from './related-research'
import { GraphContent, type ResearchFlowNode as FlowNode } from './graph-canvas'
import { useTranslation } from 'react-i18next'

function GraphCanvasControls() {
  const { t } = useTranslation()
  const flow = useReactFlow<FlowNode>(),
    { zoom } = useViewport(),
    view = useApp((state) => state.view)!,
    { mode, detail, focusId } = graphPresentation(view),
    sceneKey = JSON.stringify([mode, detail, focusId]),
    [previous, setPrevious] = useState<{
      sceneKey: string
      viewport: { x: number; y: number; zoom: number }
    } | null>(null),
    previousViewport = previous?.sceneKey === sceneKey ? previous.viewport : null
  const focusNode = () => {
    const node = flow.getNode(view.selectedId)
    if (node)
      void flow.setCenter(
        node.position.x + CARD_WIDTH / 2,
        node.position.y + (node.height ?? 144) / 2,
        { zoom: 1, duration: 250 },
      )
  }
  return (
    <div className="canvas-controls" role="group" aria-label={t('画布操作')}>
      <button
        title={t('缩小')}
        aria-label={t('缩小画布')}
        onClick={() => void flow.zoomOut({ duration: 150 })}
      >
        <Minus size={16} />
      </button>
      <span>{Math.round(zoom * 100)}%</span>
      <button
        title={t('放大')}
        aria-label={t('放大画布')}
        onClick={() => void flow.zoomIn({ duration: 150 })}
      >
        <Plus size={16} />
      </button>
      <i />
      <button
        title={t('查看全图')}
        aria-label={t('查看全图')}
        onClick={() => {
          if (zoom >= 0.6) setPrevious({ sceneKey, viewport: flow.getViewport() })
          void flow.fitView({
            nodes: flow.getNodes().map((node) => ({ id: node.id })),
            padding: 0.1,
            duration: 300,
            minZoom: 0.001,
            maxZoom: 0.95,
          })
        }}
      >
        <Scan size={16} />
      </button>
      <button title={t('定位当前研究')} aria-label={t('定位当前研究')} onClick={() => focusNode()}>
        <Focus size={16} />
      </button>
      <button
        title={t('返回上次视角')}
        aria-label={t('返回上次视角')}
        disabled={!previousViewport}
        onClick={() => {
          if (previousViewport) void flow.setViewport(previousViewport, { duration: 250 })
        }}
      >
        <CornerDownRight size={16} />
      </button>
      <button
        title={t('恢复自动布局')}
        aria-label={t('恢复自动布局')}
        onClick={() => {
          const state = useApp.getState(),
            current = state.view!,
            nodes = state.snapshot!.nodes.filter((node) => node.workspaceId === state.workspaceId),
            rootId = current.graph?.focusId ?? nodes.find((node) => !node.parentId)!.id
          const patch = transitionView(nodes, current, { type: 'scene', patch: { positions: {} } })
          state.setView({
            ...patch,
            ...(mode === 'mindmap'
              ? {
                  graph: {
                    ...patch.graph,
                    branchSides: {
                      ...current.graph?.branchSides,
                      ...mindmapBranchSides(nodes, rootId),
                    },
                  },
                }
              : {}),
          })
        }}
      >
        <LayoutGrid size={16} />
      </button>
    </div>
  )
}
function ResearchGraphWorkspace() {
  const view = useApp((s) => s.view)!,
    { focusId } = graphPresentation(view),
    { zoom } = useViewport(),
    target = useApp((state) => state.navigationTarget),
    located = useRef<number | undefined>(undefined),
    locateRequest =
      target && target.nodeId === view.selectedId && target.serial !== located.current
        ? target
        : undefined,
    onLocated = () => {
      if (target) located.current = target.serial
    }
  return (
    <div
      className={`research-canvas ${zoom < 0.6 ? 'is-overview' : ''} ${focusId ? 'is-focused-branch' : ''}`}
    >
      <BranchTrail />
      <RelatedResearch key={view.selectedId} />
      <GraphContent locateRequest={locateRequest} onLocated={onLocated} />
      <GraphDock>
        <GraphCanvasControls />
      </GraphDock>
    </div>
  )
}

export function ResearchGraph() {
  const workspaceId = useApp((state) => state.workspaceId)
  return (
    <ReactFlowProvider key={workspaceId}>
      <ResearchGraphWorkspace />
    </ReactFlowProvider>
  )
}
