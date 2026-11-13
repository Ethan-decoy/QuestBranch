import {
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  type HTMLAttributes,
  type KeyboardEvent,
} from 'react'
import { ContextMenu, DropdownMenu } from 'radix-ui'
import {
  ChevronRight,
  MoreHorizontal,
  Plus,
  Pin,
  LoaderCircle,
  MessageSquare,
  Folder,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp, download } from '../state'
import { client } from '../client'
import type { ProjectCommand } from '../../research/projects'
import './projects.css'

type Action = { label: string; disabled?: boolean } & (
  { run: () => void; items?: never } | { items: Action[]; run?: never }
)
const dragType = (kind: SortItem['kind']) => `application/x-questbranch-${kind}`
type SortItem = { kind: 'project' | 'research'; id: string }
type DropTarget = SortItem & { placement: 'before' | 'after' }
type DropHandlers = Pick<
  HTMLAttributes<HTMLDivElement>,
  'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop'
>
const sameItem = (a: SortItem | null, b: SortItem) => a?.kind === b.kind && a.id === b.id
function ObjectMenu({
  actions,
  children,
  drop,
}: {
  actions: Action[]
  children: ReactNode
  drop?: DropHandlers
}) {
  const { t } = useTranslation()
  const items = (context: boolean, entries = actions): ReactNode => {
    const Item = context ? ContextMenu.Item : DropdownMenu.Item,
      Sub = context ? ContextMenu.Sub : DropdownMenu.Sub,
      SubTrigger = context ? ContextMenu.SubTrigger : DropdownMenu.SubTrigger,
      SubContent = context ? ContextMenu.SubContent : DropdownMenu.SubContent,
      Portal = context ? ContextMenu.Portal : DropdownMenu.Portal
    return entries.map((action, index) =>
      action.items ? (
        <Sub key={`${action.label}:${index}`}>
          <SubTrigger
            className="project-menu-item project-submenu-trigger"
            disabled={action.disabled}
          >
            {action.label}
            <ChevronRight size={13} />
          </SubTrigger>
          <Portal>
            <SubContent className="project-menu" sideOffset={4}>
              {items(context, action.items)}
            </SubContent>
          </Portal>
        </Sub>
      ) : (
        <Item
          key={`${action.label}:${index}`}
          className="project-menu-item"
          title={action.label}
          disabled={action.disabled}
          onSelect={action.run}
        >
          {action.label}
        </Item>
      ),
    )
  }
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div className="project-entry" {...drop}>
          {children}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="icon-button project-more"
                aria-label={t('更多操作')}
                title={t('更多操作')}
              >
                <MoreHorizontal size={15} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="project-menu" align="end" sideOffset={4}>
                {items(false)}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="project-menu">{items(true)}</ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
export function ProjectSidebar({ onNavigate = () => {} }: { onNavigate?: () => void }) {
  const { t } = useTranslation(),
    state = useApp(),
    snapshot = state.snapshot!
  const [editing, setEditing] = useState<{
      kind: 'project' | 'research'
      id: string
      name: string
    } | null>(null),
    [move, setMove] = useState<string | null>(null),
    [target, setTarget] = useState(''),
    [saving, setSaving] = useState(false),
    [dragged, setDragged] = useState<SortItem | null>(null),
    [dropTarget, setDropTarget] = useState<DropTarget | null>(null),
    [sorting, setSorting] = useState(false),
    [sortStatus, setSortStatus] = useState('')
  const composing = useRef(false),
    compositionUntil = useRef(0),
    dragSource = useRef<SortItem | null>(null),
    suppressClickUntil = useRef(0),
    sortPending = useRef(false)
  const nav = snapshot.navigation ?? { collapsed: [], recent: [] },
    preferences = snapshot.researchNavigation ?? {},
    projects = snapshot.projects ?? []
  const perform = async (command: ProjectCommand) => {
    try {
      await state.projectCommand(command)
      if (command.type === 'select-project' || command.type === 'select-research') onNavigate()
      return true
    } catch {
      return false
    }
  }
  const navigate = (workspaceId: string) => void perform({ type: 'select-research', workspaceId })
  const exportResearch = (workspace: (typeof snapshot.workspaces)[number]) =>
    void client
      .exportWorkspace(workspace.id)
      .then((data) => download(data, workspace.name + '.questbranch.json'))
      .catch((error) => state.setError(String(error)))
  const focusItem = (item: SortItem) => {
    requestAnimationFrame(() => {
      const attribute = item.kind === 'project' ? 'data-project-id' : 'data-workspace-id',
        row = [...document.querySelectorAll<HTMLElement>(`[${attribute}]`)].find(
          (element) => element.getAttribute(attribute) === item.id,
        )
      row
        ?.querySelector<HTMLButtonElement>(
          item.kind === 'project' ? '.project-name' : '.project-study-button',
        )
        ?.focus()
    })
  }
  const reorder = async (source: SortItem, target: DropTarget) => {
    if (sortPending.current || source.kind !== target.kind || sameItem(source, target)) return
    sortPending.current = true
    setSorting(true)
    setSortStatus('')
    try {
      const success = await perform(
        source.kind === 'project'
          ? {
              type: 'reorder-project',
              projectId: source.id,
              targetProjectId: target.id,
              placement: target.placement,
            }
          : {
              type: 'reorder-research',
              workspaceId: source.id,
              targetWorkspaceId: target.id,
              placement: target.placement,
            },
      )
      if (success) {
        setSortStatus(source.kind === 'project' ? t('项目顺序已更新') : t('研究顺序已更新'))
        focusItem(source)
      }
    } finally {
      sortPending.current = false
      setSorting(false)
    }
  }
  const endDrag = () => {
    dragSource.current = null
    setDragged(null)
    setDropTarget(null)
    suppressClickUntil.current = performance.now() + 250
  }
  const canDrop = (source: SortItem, target: SortItem) => {
    if (source.kind !== target.kind) return false
    if (source.kind === 'project') {
      const a = projects.find((p) => p.id === source.id),
        b = projects.find((p) => p.id === target.id)
      return !!a?.available && !!b?.available && !!a.pinned === !!b.pinned
    }
    const a = snapshot.workspaces.find((w) => w.id === source.id),
      b = snapshot.workspaces.find((w) => w.id === target.id)
    return !!a && !!b && a.projectId === b.projectId
  }
  const dropHandlers = (item: SortItem, enabled: boolean): DropHandlers => {
    const destination = (event: DragEvent<HTMLElement>): DropTarget | null => {
      if (!enabled || !dragSource.current || !canDrop(dragSource.current, item)) return null
      const rect = event.currentTarget.getBoundingClientRect()
      return { ...item, placement: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' }
    }
    const hover = (event: DragEvent<HTMLDivElement>) => {
      const target = destination(event)
      if (!target) {
        setDropTarget(null)
        return
      }
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      setDropTarget((previous) =>
        sameItem(dragSource.current, target)
          ? null
          : previous && sameItem(previous, target) && previous.placement === target.placement
            ? previous
            : target,
      )
    }
    return {
      onDragEnter: hover,
      onDragOver: hover,
      onDragLeave: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDropTarget((previous) => (previous && sameItem(previous, item) ? null : previous))
      },
      onDrop: (event) => {
        const target = destination(event),
          source = dragSource.current
        if (!source || !target || event.dataTransfer.getData(dragType(source.kind)) !== source.id)
          return
        event.preventDefault()
        event.stopPropagation()
        endDrag()
        void reorder(source, target)
      },
    }
  }
  const dragProps = (item: SortItem, enabled: boolean) => ({
    draggable: enabled,
    onDragStart: (event: DragEvent<HTMLButtonElement>) => {
      if (!enabled) {
        event.preventDefault()
        return
      }
      dragSource.current = item
      setDragged(item)
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData(dragType(item.kind), item.id)
    },
    onDragEnd: endDrag,
  })
  const keySort = (event: KeyboardEvent<HTMLElement>, item: SortItem, enabled: boolean) => {
    if (
      !enabled ||
      !event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !['ArrowUp', 'ArrowDown'].includes(event.key)
    )
      return false
    event.preventDefault()
    event.stopPropagation()
    const workspace = snapshot.workspaces.find((w) => w.id === item.id),
      project = projects.find((p) => p.id === item.id),
      siblings =
        item.kind === 'project'
          ? projects.filter((p) => p.available && !!p.pinned === !!project?.pinned)
          : snapshot.workspaces
              .filter((w) => w.projectId === workspace?.projectId && !preferences[w.id]?.archivedAt)
              .sort((a, b) => (preferences[a.id]?.order ?? 0) - (preferences[b.id]?.order ?? 0)),
      index = siblings.findIndex((entry) => entry.id === item.id),
      up = event.key === 'ArrowUp',
      target = siblings[index + (up ? -1 : 1)]
    if (target)
      void reorder(item, { kind: item.kind, id: target.id, placement: up ? 'before' : 'after' })
    return true
  }
  const finishRename = () => {
    const target = editing
    setEditing(null)
    if (target) focusItem(target)
  }
  const commitRename = async () => {
    if (!editing || !editing.name.trim()) return
    setSaving(true)
    try {
      await state.projectCommand(
        editing.kind === 'project'
          ? { type: 'rename-project', projectId: editing.id, name: editing.name }
          : { type: 'rename-research', workspaceId: editing.id, name: editing.name },
      )
      finishRename()
    } catch {
    } finally {
      setSaving(false)
    }
  }
  const input = (kind: 'project' | 'research', id: string, name: string) =>
    editing?.id === id && editing.kind === kind ? (
      <input
        className="project-rename"
        aria-label={t('重命名')}
        autoFocus
        value={editing.name}
        disabled={saving}
        maxLength={100}
        onChange={(event) => setEditing({ ...editing, name: event.target.value })}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={() => {
          composing.current = false
          compositionUntil.current = performance.now() + 50
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') finishRename()
          if (
            event.key === 'Enter' &&
            !event.nativeEvent.isComposing &&
            !composing.current &&
            performance.now() >= compositionUntil.current
          ) {
            event.preventDefault()
            void commitRename()
          }
        }}
      />
    ) : (
      <span className="project-title" title={name}>
        {name}
      </span>
    )
  const study = (workspace: (typeof snapshot.workspaces)[number]) => {
    const item: SortItem = { kind: 'research', id: workspace.id },
      project = projects.find((p) => p.id === workspace.projectId),
      archived = !!preferences[workspace.id]?.archivedAt,
      canSort = !!project?.available && !archived && !editing && !saving && !sorting,
      running = snapshot.runs.some(
        (run) => run.workspaceId === workspace.id && run.status === 'running',
      )
    const actions: Action[] = [
      {
        label: t('重命名'),
        run: () => setEditing({ kind: 'research', id: workspace.id, name: workspace.name }),
      },
      {
        label: preferences[workspace.id]?.pinned ? t('取消固定') : t('固定'),
        run: () =>
          void perform({
            type: 'pin-research',
            workspaceId: workspace.id,
            pinned: !preferences[workspace.id]?.pinned,
          }),
      },
      {
        label: t('移动到项目'),
        disabled:
          running ||
          projects.filter((p) => p.available && p.id !== workspace.projectId).length === 0,
        run: () => {
          setMove(workspace.id)
          setTarget(projects.find((p) => p.available && p.id !== workspace.projectId)?.id ?? '')
        },
      },
      {
        label: t('导出研究'),
        run: () => exportResearch(workspace),
      },
      {
        label: archived ? t('恢复研究') : t('归档研究'),
        disabled: running,
        run: () =>
          void perform({
            type: 'archive-research',
            workspaceId: workspace.id,
            archived: !archived,
          }),
      },
    ]
    return (
      <div
        key={workspace.id}
        className={`project-study ${sameItem(dragged, item) ? 'is-dragging' : ''}`}
        data-workspace-id={workspace.id}
        data-drop-position={
          dropTarget && sameItem(dropTarget, item) ? dropTarget.placement : undefined
        }
        {...dropHandlers(item, canSort)}
      >
        <ObjectMenu actions={actions}>
          <button
            className={`project-study-button ${state.workspaceId === workspace.id ? 'active' : ''}`}
            aria-current={state.workspaceId === workspace.id ? 'page' : undefined}
            aria-keyshortcuts={canSort ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
            title={canSort ? t('拖动调整顺序，Alt+↑/↓ 移动') : workspace.name}
            disabled={!project?.available}
            {...dragProps(item, canSort)}
            onClick={() => {
              if (!dragSource.current && performance.now() >= suppressClickUntil.current)
                navigate(workspace.id)
            }}
            onKeyDown={(event) => {
              if (keySort(event, item, canSort)) return
              if (event.key === 'F2') {
                event.preventDefault()
                setEditing({ kind: 'research', id: workspace.id, name: workspace.name })
              }
            }}
          >
            {running ? (
              <LoaderCircle size={14} className="spin" />
            ) : preferences[workspace.id]?.pinned ? (
              <Pin size={13} />
            ) : (
              <MessageSquare size={14} />
            )}{' '}
            {editing?.id === workspace.id ? (
              <span className="project-title">{workspace.name}</span>
            ) : (
              input('research', workspace.id, workspace.name)
            )}
          </button>
          {editing?.id === workspace.id && (
            <div className="project-inline-edit">
              {input('research', workspace.id, workspace.name)}
              <button
                className="icon-button"
                aria-label={t('保存名称')}
                onClick={() => void commitRename()}
              >
                ↵
              </button>
            </div>
          )}
        </ObjectMenu>
      </div>
    )
  }
  return (
    <div className="projects-navigation">
      <span className="sr-only" role="status">
        {sortStatus}
      </span>
      <div className="sidebar-label">
        <span>{t('项目')}</span>
        <div className="project-actions">
          <button
            className="icon-button"
            aria-label={t('新建项目')}
            title={t('新建项目')}
            onClick={() => state.open('project')}
          >
            <Plus size={15} />
          </button>
        </div>
      </div>
      <nav aria-label={t('项目与研究')}>
        {projects.map((project) => {
          const item: SortItem = { kind: 'project', id: project.id },
            canSort = project.available && !editing && !saving && !sorting,
            collapsed = nav.collapsed.includes(project.id),
            list = snapshot.workspaces
              .filter((w) => w.projectId === project.id && !preferences[w.id]?.archivedAt)
              .sort((a, b) => (preferences[a.id]?.order ?? 0) - (preferences[b.id]?.order ?? 0)),
            archived = snapshot.workspaces.filter(
              (w) => w.projectId === project.id && preferences[w.id]?.archivedAt,
            ),
            running = snapshot.runs.some(
              (run) => list.some((w) => w.id === run.workspaceId) && run.status === 'running',
            )
          const actions: Action[] = [
            {
              label: t('新建研究'),
              disabled: !project.available,
              run: () => state.open('workspace', { projectId: project.id }),
            },
            {
              label: t('重命名'),
              disabled: !project.available,
              run: () => setEditing({ kind: 'project', id: project.id, name: project.name }),
            },
            {
              label: project.pinned ? t('取消固定') : t('固定'),
              disabled: !project.available,
              run: () =>
                void perform({
                  type: 'pin-project',
                  projectId: project.id,
                  pinned: !project.pinned,
                }),
            },
            {
              label: t('保存位置'),
              run: () => {
                void perform({ type: 'select-project', projectId: project.id }).then(
                  (success) => success && state.open('settings', { settingsSection: 'storage' }),
                )
              },
            },
            ...(archived.length
              ? [
                  {
                    label: t('已归档研究'),
                    disabled: !project.available,
                    items: archived.map((workspace) => ({
                      label: workspace.name,
                      items: [
                        { label: t('打开（只读）'), run: () => navigate(workspace.id) },
                        { label: t('导出研究'), run: () => exportResearch(workspace) },
                        {
                          label: t('恢复研究'),
                          run: () =>
                            void perform({
                              type: 'archive-research',
                              workspaceId: workspace.id,
                              archived: false,
                            }),
                        },
                      ],
                    })),
                  },
                ]
              : []),
            {
              label: t('关闭项目'),
              disabled: running,
              run: () => void perform({ type: 'close-project', projectId: project.id }),
            },
          ]
          return (
            <section
              className={`project-group ${sameItem(dragged, item) ? 'is-dragging' : ''}`}
              data-project-id={project.id}
              data-drop-position={
                dropTarget && sameItem(dropTarget, item) ? dropTarget.placement : undefined
              }
              key={project.id}
              {...dropHandlers(item, canSort)}
            >
              <ObjectMenu actions={actions} drop={dropHandlers(item, canSort)}>
                <button
                  className="icon-button project-chevron"
                  aria-expanded={!collapsed}
                  aria-label={t('展开或折叠项目')}
                  onClick={() =>
                    void perform({
                      type: 'save-navigation',
                      navigation: {
                        ...nav,
                        collapsed: collapsed
                          ? nav.collapsed.filter((key) => key !== project.id)
                          : [...nav.collapsed, project.id],
                      },
                    })
                  }
                >
                  <ChevronRight size={13} className={collapsed ? '' : 'expanded'} />
                </button>
                <button
                  className={`project-name ${snapshot.activeProjectId === project.id ? 'current' : ''}`}
                  title={
                    canSort
                      ? `${t('拖动调整顺序，Alt+↑/↓ 移动')}\n${project.directory}`
                      : project.directory
                  }
                  aria-keyshortcuts={canSort ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
                  {...dragProps(item, canSort)}
                  onClick={() => {
                    if (dragSource.current || performance.now() < suppressClickUntil.current) return
                    void perform({ type: 'select-project', projectId: project.id })
                    if (collapsed)
                      void state.projectCommand({
                        type: 'save-navigation',
                        navigation: {
                          ...nav,
                          collapsed: nav.collapsed.filter((key) => key !== project.id),
                        },
                      })
                  }}
                  onKeyDown={(event) => {
                    if (keySort(event, item, canSort)) return
                    if (event.key === 'F2') {
                      event.preventDefault()
                      setEditing({ kind: 'project', id: project.id, name: project.name })
                    }
                  }}
                >
                  <Folder size={15} />
                  <span className="project-title">{project.name}</span>
                  {project.pinned && <Pin size={12} role="img" aria-label={t('固定')} />}
                  {running && <LoaderCircle size={12} className="spin" />}
                  {!project.available && <span title={project.error}>!</span>}
                </button>
                <button
                  className="icon-button project-add"
                  disabled={!project.available}
                  aria-label={t('在项目内新建研究')}
                  onClick={() => state.open('workspace', { projectId: project.id })}
                >
                  <Plus size={14} />
                </button>
                {editing?.kind === 'project' && editing.id === project.id && (
                  <div className="project-inline-edit">
                    {input('project', project.id, project.name)}
                    <button
                      className="icon-button"
                      aria-label={t('保存名称')}
                      onClick={() => void commitRename()}
                    >
                      ↵
                    </button>
                  </div>
                )}
              </ObjectMenu>
              {!collapsed && (
                <div className="project-children">
                  {list.map(study)}
                  {list.length === 0 && project.available && (
                    <button
                      className="project-empty-add"
                      onClick={() => state.open('workspace', { projectId: project.id })}
                    >
                      <Plus size={13} />
                      {t('新建研究')}
                    </button>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </nav>
      {move && (
        <div className="project-move" role="region" aria-label={t('移动研究')}>
          <select
            aria-label={t('目标项目')}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            {projects
              .filter(
                (p) =>
                  p.available && p.id !== snapshot.workspaces.find((w) => w.id === move)?.projectId,
              )
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <button
            className="button"
            disabled={saving || !target}
            onClick={async () => {
              setSaving(true)
              try {
                await state.projectCommand({
                  type: 'move-research',
                  workspaceId: move,
                  projectId: target,
                  requestId: crypto.randomUUID(),
                })
                setMove(null)
              } catch {
              } finally {
                setSaving(false)
              }
            }}
          >
            {saving ? <LoaderCircle className="spin" size={13} /> : t('移动')}
          </button>
          <button
            className="icon-button"
            disabled={saving}
            aria-label={t('取消')}
            onClick={() => setMove(null)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
