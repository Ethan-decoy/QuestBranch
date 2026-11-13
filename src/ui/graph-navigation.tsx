import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import {
  AlignLeft,
  ArrowLeft,
  Columns3,
  Focus,
  GitFork,
  Network,
  Pencil,
  Plus,
  Scan,
} from 'lucide-react'
import { useApp } from './state'
import { graphPresentation, visibleResearchRows } from './research-view'
import { ancestorPath } from '../research/context'
import { branchReport } from '../research/branching'
import { mindmapBranchSides, mindmapSidePreferences } from './layout'
import { useTranslation } from 'react-i18next'

export function toggleBranch(id: string) {
  const state = useApp.getState(),
    view = state.view!
  const collapsed = view.collapsed.includes(id)
  if (
    !collapsed &&
    ancestorPath(state.snapshot!.nodes, view.selectedId).some((node) => node.id === id)
  )
    state.select(id, { showDetails: false })
  state.setView({
    collapsed: collapsed ? view.collapsed.filter((item) => item !== id) : [...view.collapsed, id],
  })
}

function NodeActions() {
  const { t } = useTranslation()
  const state = useApp(),
    view = state.view!,
    node = state.snapshot!.nodes.find((node) => node.id === view.selectedId)!,
    archived = !!state.snapshot!.researchNavigation?.[node.workspaceId]?.archivedAt,
    focused = graphPresentation(view).focusId
  return (
    <>
      <div className="graph-tool-group" role="group" aria-label={t('分支编辑')}>
        <button
          aria-label={t('为当前研究添加方向')}
          title={
            branchReport(state.snapshot!, node.id, view)
              ? t('添加子方向 (Ctrl+Enter)')
              : t('在当前节点对话中保存报告后，再添加方向。')
          }
          disabled={archived || !branchReport(state.snapshot!, node.id, view)}
          onClick={() => state.open('node', { returnToGraph: true })}
        >
          <Plus size={16} />
        </button>
        <button
          aria-label={t('添加同级方向')}
          title={
            !node.parentId
              ? t('根问题没有同级方向')
              : branchReport(state.snapshot!, node.parentId, view)
                ? t('添加同级方向 (Shift+Enter)')
                : t('在父节点对话中保存报告后，再添加同级方向。')
          }
          disabled={archived || !branchReport(state.snapshot!, node.parentId, view)}
          onClick={() => state.open('sibling', { returnToGraph: true })}
        >
          <GitFork size={15} />
        </button>
      </div>
      <div className="graph-tool-group" role="group" aria-label={t('节点详情')}>
        <button
          aria-label={t('编辑当前研究')}
          title={t('编辑问题 (F2)')}
          disabled={archived}
          onClick={() => state.open('edit')}
        >
          <Pencil size={14} />
        </button>
      </div>
      <div className="graph-tool-group" role="group" aria-label={t('分支浏览')}>
        <button
          aria-label={t('聚焦当前分支')}
          title={t('只显示当前分支')}
          disabled={!node.parentId || focused === node.id}
          onClick={() => state.navigateGraph({ type: 'focus', nodeId: node.id })}
        >
          <Focus size={15} />
        </button>
      </div>
    </>
  )
}

export function BranchTrail() {
  const { t } = useTranslation()
  const state = useApp(),
    view = state.view!,
    { focusId } = graphPresentation(view),
    path = focusId ? ancestorPath(state.snapshot!.nodes, focusId) : []
  if (!focusId && !view.graph?.history?.length) return null
  return (
    <nav className="branch-trail" aria-label={t('分支聚焦路径')}>
      <button
        aria-label={t('返回上一视图')}
        title={t('返回上一视图 (Esc)')}
        onClick={() => state.navigateGraph({ type: 'back' })}
      >
        <ArrowLeft size={15} />
      </button>
      {focusId && (
        <button
          aria-label={t('返回全图')}
          title={t('返回全图')}
          onClick={() => state.navigateGraph({ type: 'global' })}
        >
          <Scan size={15} />
        </button>
      )}
      <span title={path.map((node) => node.title).join(' / ')}>
        {focusId ? path.map((node) => node.title).join(' / ') : t('全图')}
      </span>
    </nav>
  )
}

export function GraphDock({ children }: { children?: ReactNode }) {
  const { t } = useTranslation()
  const state = useApp(),
    view = state.view!,
    { mode, detail } = graphPresentation(view),
    dock = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = dock.current
    if (!element) return
    const measure = () =>
      element.parentElement?.style.setProperty(
        '--graph-dock-height',
        `${Math.ceil(element.getBoundingClientRect().height)}px`,
      )
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={dock} className="graph-tools" role="group" aria-label={t('图谱工具')}>
      <div className="graph-view-tools">
        <div className="graph-tool-group graph-layouts" role="group" aria-label={t('结构展示')}>
          {(
            [
              ['horizontal', t('横向图'), Columns3],
              ['mindmap', t('中心导图'), Network],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              aria-label={label}
              title={label}
              aria-pressed={mode === value}
              onClick={() => state.navigateGraph({ type: 'mode', mode: value })}
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
        <div className="graph-tool-group" role="group" aria-label={t('节点显示')}>
          <button
            aria-label={t('显示阶段摘要')}
            title={detail === 'summary' ? t('切换为简洁节点') : t('显示阶段摘要')}
            aria-pressed={detail === 'summary'}
            onClick={() =>
              state.navigateGraph({
                type: 'detail',
                detail: detail === 'summary' ? 'compact' : 'summary',
              })
            }
          >
            <AlignLeft size={16} />
          </button>
        </div>
        <NodeActions />
      </div>
      {children}
    </div>
  )
}

/** Deliberately scoped to topic focus: text input, IME, dialogs and normal Tab navigation retain their behavior. */
export function handleGraphKey(event: KeyboardEvent, id: string) {
  const state = useApp.getState(),
    view = state.view!,
    node = state.snapshot!.nodes.find((node) => node.id === id),
    target = event.target as HTMLElement
  if (
    !node ||
    event.nativeEvent.isComposing ||
    state.dialog ||
    target.closest('input, textarea, select, button, [contenteditable="true"]')
  )
    return
  const nodes = state.snapshot!.nodes.filter((node) => node.workspaceId === state.workspaceId),
    { focusId, mode } = graphPresentation(view),
    rows = visibleResearchRows(nodes, view.collapsed, focusId),
    children = nodes.filter((item) => item.parentId === id),
    folded = view.collapsed.includes(id),
    rootId = focusId ?? rows[0]?.node.id,
    rootChildren = nodes.filter((item) => item.parentId === rootId),
    sides = rootId ? mindmapBranchSides(nodes, rootId, mindmapSidePreferences(nodes, view)) : {},
    rootChild = ancestorPath(nodes, id).find((item) => item.parentId === rootId),
    left = mode === 'mindmap' && !!rootChild && sides[rootChild.id] === 'left'
  let next: string | undefined
  if (event.key === 'Enter' && !event.altKey) {
    if (event.ctrlKey || event.metaKey) state.open('node', { returnToGraph: true })
    else if (event.shiftKey && node.parentId) state.open('sibling', { returnToGraph: true })
    else if (!event.shiftKey) state.setReadingMode(true)
    else return
  } else if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
  else if (event.key === 'F2') state.open('edit')
  else if (event.key === 'Escape' && view.graph?.history?.length)
    state.navigateGraph({ type: 'back' })
  else if (event.key === ' ' && children.length) toggleBranch(id)
  else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
    const candidates = rows
        .filter(
          (row) =>
            row.node.parentId === node.parentId &&
            (mode !== 'mindmap' ||
              node.parentId !== rootId ||
              sides[row.node.id] === (left ? 'left' : 'right')),
        )
        .map((row) => row.node),
      index = candidates.findIndex((item) => item.id === id)
    next =
      event.key === 'Home'
        ? candidates[0]?.id
        : event.key === 'End'
          ? candidates.at(-1)?.id
          : candidates[index + (event.key === 'ArrowDown' ? 1 : -1)]?.id
  } else if (
    mode === 'mindmap' &&
    id === rootId &&
    (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
  ) {
    if (folded) toggleBranch(id)
    else
      next = rootChildren.find(
        (item) => sides[item.id] === (event.key === 'ArrowLeft' ? 'left' : 'right'),
      )?.id
  } else if (event.key === (left ? 'ArrowLeft' : 'ArrowRight')) {
    if (folded) toggleBranch(id)
    else next = children[0]?.id
  } else if (event.key === (left ? 'ArrowRight' : 'ArrowLeft')) {
    if (node.id !== focusId) next = node.parentId ?? undefined
  } else return
  event.preventDefault()
  event.stopPropagation()
  if (next) {
    state.select(next, { showDetails: false })
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(next!)}"]`)
        ?.focus(),
    )
  }
}
