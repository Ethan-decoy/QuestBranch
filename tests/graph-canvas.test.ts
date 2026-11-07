import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import type { Snapshot, ViewState } from '../src/research/types'
import { defaultSettings } from '../src/research/types'
import type { DrawnResearch } from '../src/ui/graph-visuals'
import { starterResearch } from '../src/research/seed'
import { layoutGraph } from '../src/ui/layout'
import { graphSubtrees } from '../src/ui/graph-visuals'
import { displayBranchColor } from '../src/ui/theme-colors'

let state: {
  snapshot: Snapshot
  view: ViewState
  workspaceId: string
  readingMode: boolean
  compactPane: string
  select: () => void
}
let drawn: DrawnResearch[]
let theme: 'light' | 'dark'

vi.mock('../src/ui/state', () => ({
  useApp: (selector: (value: typeof state) => unknown) => selector(state),
}))
vi.mock('../src/ui/theme', () => ({
  useTheme: (selector: (value: { theme: typeof theme }) => unknown) => selector({ theme }),
}))
vi.mock('../src/ui/client', () => ({ client: {} }))
vi.mock('../src/ui/graph-animation', () => ({
  useReducedGraphMotion: () => false,
  useAnimatedGraph: () => ({ drawn, animating: false, settleDraggedNode: vi.fn() }),
}))
vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react')
  return {
    ...actual,
    useReactFlow: () => ({}),
    useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    ReactFlow: ({ nodes }: { nodes: Node[] }) =>
      createElement('div', {
        'data-regions': JSON.stringify(
          nodes.filter((node) => node.type === 'researchRegion').map((node) => node.style),
        ),
      }),
  }
})

import { GraphContent } from '../src/ui/graph-canvas'

it.each(['light', 'dark'] as const)(
  '%s：最新目录已移除分支而动画仍保留旧布局时，画布可以渲染且分区颜色正确',
  (mode) => {
    theme = mode
    const seed = starterResearch()
    const root = seed.workspace.rootId
    const family = seed.nodes.find((node) => node.parentId === root)!
    const removed = graphSubtrees(seed.nodes).get(family.id)!
    drawn = layoutGraph(seed.nodes, [], {}).map((item) => ({ ...item, opacity: 1 }))
    state = {
      snapshot: {
        version: 1,
        workspaces: [seed.workspace],
        reports: seed.reports,
        runs: [],
        messages: [],
        views: {},
        settings: defaultSettings,
        nodes: seed.nodes.map((node) =>
          removed.has(node.id) ? { ...node, removedAt: '2026-11-06T00:00:00Z' } : node,
        ),
      },
      view: { selectedId: root, collapsed: [], drafts: {} },
      workspaceId: seed.workspace.id,
      readingMode: false,
      compactPane: 'map',
      select: vi.fn(),
    }
    const render = () => renderToStaticMarkup(createElement(GraphContent, { onLocated: vi.fn() }))
    expect(render).not.toThrow()
    expect(render()).toContain(displayBranchColor(family.color, mode))

    drawn = drawn.map((item) =>
      removed.has(item.node.id) ? { ...item, leaving: true, opacity: 0.5 } : item,
    )
    expect(render).not.toThrow()
  },
)
