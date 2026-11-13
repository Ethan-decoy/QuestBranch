import { useEffect, useRef, useState } from 'react'
import { version } from '../../package.json'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  Columns2,
  GitBranch,
  Layers3,
  LoaderCircle,
  Plus,
  Search,
  Settings,
  Sparkles,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  FolderOpen,
  CircleAlert,
} from 'lucide-react'
import { useApp, download, flushView, flushViewNow, openProjectFolder } from './state'
import { branchReport } from '../research/branching'
import { client } from './client'
import { Button, Logo, SignalIcon, StatusLabel, nodeStatus } from './components'
import { ResearchGraph } from './graph'
import { freshBranchCounts, unseenGraphNodes } from './graph-visuals'
import { ResearchDetails } from './details'
import { AppDialogs } from './dialogs'
import { ProjectSidebar } from './projects/project-sidebar'
import { useTheme } from './theme'
import { displayBranchColor } from './theme-colors'
import { PanelResizer } from './panel-resizer'
import { resizeWorkbenchPane, workbenchLayout, type WorkbenchPane } from './workbench-layout'
import { useTranslation } from 'react-i18next'
import { STARTER_WORKSPACE_ID } from '../research/seed'

export function App() {
  const { t } = useTranslation()
  const theme = useTheme((state) => state.theme)
  const snapshot = useApp((s) => s.snapshot),
    workspaceId = useApp((s) => s.workspaceId),
    view = useApp((s) => s.view),
    open = useApp((s) => s.open),
    select = useApp((s) => s.select),
    changeWorkspace = useApp((s) => s.workspace),
    error = useApp((s) => s.error),
    busy = useApp((s) => s.busy),
    layoutWidths = useApp((s) => s.layoutWidths),
    setLayoutWidths = useApp((s) => s.setLayoutWidths),
    readingMode = useApp((s) => s.readingMode),
    pane = useApp((s) => s.compactPane),
    showPane = useApp((s) => s.showPane),
    fileInput = useRef<HTMLInputElement>(null),
    [exporting, setExporting] = useState(false),
    [compact, setCompact] = useState(() => matchMedia('(max-width: 1100px)').matches),
    [containerWidth, setContainerWidth] = useState(() => window.innerWidth),
    [navigationOpen, setNavigationOpen] = useState(false),
    [navigationCollapsed, setNavigationCollapsed] = useState(false),
    menuButton = useRef<HTMLButtonElement>(null),
    closeNavigation = useRef<HTMLButtonElement>(null)
  const closeNav = () => {
    setNavigationOpen(false)
    if (compact) requestAnimationFrame(() => menuButton.current?.focus())
  }
  const sidebarHidden = compact ? !navigationOpen : navigationCollapsed
  const layout = workbenchLayout(containerWidth, layoutWidths, !sidebarHidden)
  const resizePane = (pane: WorkbenchPane, width: number) =>
    setLayoutWidths(resizeWorkbenchPane(layout, layoutWidths, pane, width))
  const navigate = (id: string) => {
    select(id)
    if (compact) closeNav()
  }
  useEffect(() => {
    const media = matchMedia('(max-width: 1100px)')
    const resize = () => setContainerWidth(window.innerWidth)
    const change = () => {
      setCompact(media.matches)
      setNavigationOpen(false)
    }
    media.addEventListener('change', change)
    window.addEventListener('resize', resize)
    const observer = new ResizeObserver(resize)
    observer.observe(document.documentElement)
    resize()
    return () => {
      media.removeEventListener('change', change)
      window.removeEventListener('resize', resize)
      observer.disconnect()
    }
  }, [])
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let refreshing = false
    const poll = async () => {
      if (stopped || document.hidden || refreshing) return
      refreshing = true
      await useApp.getState().refresh()
      refreshing = false
      if (!stopped && !document.hidden) {
        const running = useApp.getState().snapshot?.runs.some((run) => run.status === 'running')
        timer = setTimeout(() => void poll(), running ? 250 : 1100)
      }
    }
    const visibility = () => {
      clearTimeout(timer)
      if (!document.hidden) void poll()
    }
    const unsubscribe = useApp.subscribe((state, previous) => {
      const active = state.snapshot?.runs.some((run) => run.status === 'running')
      const wasActive = previous.snapshot?.runs.some((run) => run.status === 'running')
      if (active !== wasActive) visibility()
    })
    void poll()
    document.addEventListener('visibilitychange', visibility)
    const keys = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (useApp.getState().dialog) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        open('search')
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault()
        open('settings')
      }
    }
    window.addEventListener('keydown', keys)
    window.addEventListener('beforeunload', flushView)
    return () => {
      stopped = true
      clearTimeout(timer)
      unsubscribe()
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('keydown', keys)
      window.removeEventListener('beforeunload', flushView)
    }
  }, [])
  if (!snapshot || !view)
    return (
      <div className="loading-screen">
        <Logo />
        <LoaderCircle size={22} className="spin" />
        <p>{error || t('正在打开你的研究空间…')}</p>
      </div>
    )
  const candidateWorkspace = snapshot.workspaces.find((w) => w.id === workspaceId),
    nodes = snapshot.nodes.filter((n) => n.workspaceId === workspaceId && !n.removedAt),
    root = nodes.find((n) => n.id === candidateWorkspace?.rootId)
  if (!candidateWorkspace || !root)
    return client.projects ? <ProjectLanding /> : <ProjectUnavailable />
  const workspace = candidateWorkspace,
    archived = !!snapshot.researchNavigation?.[workspaceId]?.archivedAt,
    branches = nodes.filter((n) => n.parentId === root.id),
    reports = snapshot.reports.filter((r) => r.workspaceId === workspaceId),
    pending = nodes.filter((n) => !reports.some((r) => r.nodeId === n.id)).length,
    freshCounts = freshBranchCounts(nodes, unseenGraphNodes(nodes, view))
  async function exportData() {
    setExporting(true)
    try {
      download(
        await client.exportWorkspace(workspaceId),
        `${workspace.name.replace(/[<>:"/\\|?*]/g, '-')}.questbranch.json`,
      )
    } catch (error) {
      useApp.getState().setError(error instanceof Error ? error.message : t('导出失败'))
    } finally {
      setExporting(false)
    }
  }
  async function managePlugin() {
    try {
      await flushViewNow()
      await client.host?.managePlugin()
    } catch (error) {
      useApp
        .getState()
        .setError(error instanceof Error ? error.message : t('无法打开 DSH 插件管理'))
    }
  }
  async function importData(file: File) {
    const projectId = useApp.getState().snapshot?.activeProjectId
    try {
      if (file.size > 64 * 1024 * 1024)
        throw new Error(t('导入文件超过 64 MB，请拆分研究空间或保留原数据库作为备份。'))
      const data = JSON.parse(await file.text())
      if (client.projects && projectId)
        await useApp.getState().projectCommand({ type: 'import-research', projectId, data })
      else {
        const result = await useApp.getState().command({ type: 'import-workspace', data })
        await changeWorkspace(result.id!)
      }
    } catch (error) {
      useApp
        .getState()
        .setError(error instanceof Error ? error.message : t('导入失败，请检查文件格式'))
    }
  }
  return (
    <div
      className="app-shell"
      style={
        {
          '--navigation-width': `${layout.navigation}px`,
          '--panel-width': `${layout.detail}px`,
        } as React.CSSProperties
      }
    >
      <aside
        id="workspace-navigation"
        className="sidebar"
        hidden={sidebarHidden}
        aria-label={t('工作空间导航')}
        onKeyDown={(event) => {
          if (compact && navigationOpen && event.key === 'Escape') {
            event.preventDefault()
            closeNav()
          }
        }}
      >
        <div className="sidebar-header">
          <Logo />
          <button
            ref={closeNavigation}
            className="icon-button close-navigation compact-only"
            aria-label={t('返回工作台')}
            title={t('返回工作台')}
            onClick={closeNav}
          >
            <X size={18} />
          </button>
        </div>
        <div className="sidebar-navigation">
          {client.projects ? (
            <ProjectSidebar onNavigate={closeNav} />
          ) : (
            <>
              <div className="sidebar-section">
                <div className="sidebar-label">
                  <span>
                    {t('研究空间')}{' '}
                    <span className="workspace-total">{snapshot.workspaces.length}</span>
                  </span>
                  <div className="project-actions">
                    <button
                      className="icon-button"
                      aria-label={t('新建研究空间')}
                      title={t('新建研究空间')}
                      onClick={() => open('workspace')}
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                </div>
                <nav aria-label={t('研究空间')}>
                  {snapshot.workspaces.map((w) => (
                    <button
                      className={`workspace-item ${w.id === workspaceId ? 'active' : ''}`}
                      title={w.name}
                      aria-current={w.id === workspaceId ? 'page' : undefined}
                      key={w.id}
                      onClick={() => {
                        void changeWorkspace(w.id)
                        if (compact) closeNav()
                      }}
                    >
                      <span className="workspace-icon">
                        <GitBranch size={16} />
                      </span>
                      <strong>{w.name}</strong>
                      {w.id === STARTER_WORKSPACE_ID && (
                        <span className="workspace-example">{t('示例')}</span>
                      )}
                      <span className="workspace-node-count" title={t('研究节点数')}>
                        {
                          snapshot.nodes.filter((n) => n.workspaceId === w.id && !n.removedAt)
                            .length
                        }
                      </span>
                    </button>
                  ))}
                </nav>
                {workspace.id === STARTER_WORKSPACE_ID && snapshot.workspaces.length === 1 && (
                  <Button
                    className="start-own-research"
                    variant="ghost"
                    onClick={() => open('workspace')}
                  >
                    <Plus size={14} />
                    {t('创建自己的研究')}
                  </Button>
                )}
              </div>
              <div className="sidebar-section directions">
                <div className="sidebar-label">
                  {t('研究分支')}
                  <button
                    className="icon-button"
                    title={t('回到根问题')}
                    aria-label={t('回到根问题')}
                    onClick={() => navigate(root.id)}
                  >
                    <Layers3 size={13} />
                  </button>
                </div>
                <button
                  className={`root-link ${view.selectedId === root.id ? 'selected' : ''}`}
                  title={workspace.question}
                  onClick={() => navigate(root.id)}
                >
                  <span className="tree-root-dot" />
                  <span>{root.title}</span>
                </button>
                <nav className="branch-nav" aria-label={t('研究分支')}>
                  {branches.map((branch) => (
                    <button
                      key={branch.id}
                      className={view.selectedId === branch.id ? 'selected' : ''}
                      title={branch.question}
                      onClick={() => navigate(branch.id)}
                    >
                      <span className="branch-line" />
                      <i style={{ background: displayBranchColor(branch.color, theme) }} />
                      <span className="branch-title">{branch.title}</span>
                      {(freshCounts.get(branch.id) ?? 0) > 0 && (
                        <span className="graph-new-badge" title={t('新增方向尚未查看')}>
                          {t('新')}
                          {freshCounts.get(branch.id)}
                        </span>
                      )}
                      <StatusLabel status={nodeStatus(branch, snapshot)} compact />
                    </button>
                  ))}
                </nav>
              </div>
            </>
          )}
        </div>
        <div className="sidebar-bottom">
          <button
            className="icon-button"
            aria-label={t('模型与连接')}
            title={t('模型与连接')}
            onClick={() => open('models')}
          >
            <Sparkles size={16} />
          </button>
          <button
            className="icon-button"
            aria-label={t('设置')}
            title={t('设置 (Ctrl+,)')}
            onClick={() => open('settings')}
          >
            <Settings size={16} />
          </button>
          <button
            className="icon-button"
            aria-label={t('导入研究资料')}
            title={t('导入研究资料')}
            onClick={() => fileInput.current?.click()}
          >
            <ArrowUpFromLine size={15} />
          </button>
          {client.host ? (
            <button
              className="local-label host-version"
              aria-label={t('在 DSH 中管理 QuestBranch 插件')}
              title={t('QuestBranch {{version}} · DSH 插件管理', {
                version: client.host.version,
              })}
              onClick={() => void managePlugin()}
            >
              v{client.host.version}
            </button>
          ) : (
            <button
              className="local-label"
              title={t('关于')}
              onClick={() => open('settings', { settingsSection: 'updates' })}
            >
              v{version}
            </button>
          )}
        </div>
      </aside>
      <PanelResizer
        label={t('导航区域宽度')}
        width={layout.navigation}
        {...layout.limits.navigation}
        hidden={sidebarHidden || compact}
        onResize={(width) => resizePane('navigation', width)}
      />
      <main className="workspace-main" hidden={compact && navigationOpen}>
        <header className="topbar">
          <button
            ref={menuButton}
            className="icon-button navigation-toggle"
            aria-label={
              compact
                ? t('打开工作空间导航')
                : sidebarHidden
                  ? t('展开工作空间导航')
                  : t('收起工作空间导航')
            }
            title={compact ? t('打开导航') : sidebarHidden ? t('展开导航') : t('收起导航')}
            aria-controls="workspace-navigation"
            aria-expanded={!sidebarHidden}
            onClick={() => {
              if (compact) {
                setNavigationOpen(true)
                requestAnimationFrame(() => closeNavigation.current?.focus())
              } else setNavigationCollapsed(!navigationCollapsed)
            }}
          >
            {compact ? (
              <Menu size={18} />
            ) : sidebarHidden ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </button>
          {sidebarHidden && <Logo small />}
          <div className="workspace-breadcrumb">
            <strong title={workspace.name}>{workspace.name}</strong>
            {archived && <span className="workspace-count">{t('已归档 · 只读')}</span>}
            {/* i18next-instrument-ignore: independent node and unexplored counters */}
            <span className="workspace-count">
              {t('{{count}} 个节点', { count: nodes.length })}
              <span>·</span>
              {t('{{count}} 个待研究', { count: pending })}
            </span>
          </div>
          <div className="view-tabs compact-only" aria-label={t('工作区域')}>
            <button
              className={pane === 'map' ? 'active' : ''}
              aria-label={t('研究图谱')}
              aria-pressed={pane === 'map'}
              onClick={() => showPane('map')}
            >
              <GitBranch size={15} />
              {t('图谱')}
            </button>
            <button
              className={pane === 'detail' ? 'active' : ''}
              aria-label={t('研究详情')}
              aria-pressed={pane === 'detail'}
              onClick={() => showPane('detail')}
            >
              <BookOpen size={15} />
              {t('详情')}
            </button>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button search-button"
              onClick={() => open('search')}
              aria-label={t('搜索研究')}
              title={t('搜索研究 · Ctrl K')}
            >
              <Search size={15} />
            </button>
            <Button
              variant="ghost"
              aria-label={t('分支比较')}
              title={t('分支比较')}
              disabled={archived}
              onClick={() => open('compare')}
            >
              <Columns2 size={14} />
              <span className="action-label">{t('比较')}</span>
            </Button>
            <Button
              aria-label={t('添加研究方向')}
              title={
                branchReport(snapshot, view.selectedId, view)
                  ? t('添加研究方向')
                  : t('在当前节点对话中保存报告后，再添加方向。')
              }
              disabled={archived || !branchReport(snapshot, view.selectedId, view)}
              onClick={() => open('node')}
            >
              <Plus size={14} />
              <span className="action-label">{t('新方向')}</span>
            </Button>
            <button
              className="icon-button"
              title={t('导出当前研究空间')}
              aria-label={t('导出研究空间')}
              onClick={() => void exportData()}
              disabled={exporting}
            >
              {exporting ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <ArrowDownToLine size={16} />
              )}
            </button>
          </div>
        </header>
        <div
          className={`workspace-content ${readingMode ? 'reading-mode' : ''} ${compact ? 'compact-workspace' : ''}`}
        >
          <div className="graph-slot" hidden={readingMode || (compact && pane !== 'map')}>
            <ResearchGraph />
          </div>
          <PanelResizer
            label={t('报告区域宽度')}
            width={layout.detail}
            {...layout.limits.detail}
            reversed
            hidden={readingMode || compact}
            onResize={(width) => resizePane('detail', width)}
          />
          <div className="detail-slot" hidden={compact && pane !== 'detail' && !readingMode}>
            <ResearchDetails key={`${workspaceId}:${view.selectedId}`} />
          </div>
        </div>
      </main>
      <AppDialogs />
      <input
        type="file"
        ref={fileInput}
        accept=".json,application/json"
        hidden
        aria-label={t('导入研究文件')}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importData(file)
          event.target.value = ''
        }}
      />
      {error && (
        <div className="error-toast" role="alert">
          <div>
            <SignalIcon tone="error" size={20} />
            <span>{error}</span>
          </div>
          <button
            className="icon-button"
            aria-label={t('关闭提示')}
            onClick={() => useApp.getState().setError('')}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  )
}

function ProjectLanding() {
  const { t } = useTranslation(),
    state = useApp(),
    snapshot = state.snapshot!,
    project = snapshot.projects?.find((p) => p.id === snapshot.activeProjectId)
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label={t('工作空间导航')}>
        <div className="sidebar-header">
          <Logo />
        </div>
        <div className="sidebar-navigation">
          <ProjectSidebar />
        </div>
        <div className="sidebar-bottom">
          <button
            className="icon-button"
            aria-label={t('模型与连接')}
            onClick={() => state.open('models')}
            disabled={!project?.available}
          >
            <Sparkles size={16} />
          </button>
          <button
            className="icon-button"
            aria-label={t('设置')}
            onClick={() => state.open('settings')}
          >
            <Settings size={16} />
          </button>
        </div>
      </aside>
      <main className="project-landing">
        <h1>{project?.name ?? t('打开研究项目')}</h1>
        {project?.available ? (
          <Button
            variant="primary"
            onClick={() => state.open('workspace', { projectId: project.id })}
          >
            <Plus size={16} />
            {t('新建研究')}
          </Button>
        ) : (
          <>
            <p>{project?.error ?? (project ? t('项目文件夹不可用') : '')}</p>
            {project && <code>{project.directory}</code>}
            <Button onClick={() => void openProjectFolder()}>
              <FolderOpen size={16} />
              {t('打开项目文件夹')}
            </Button>
            <Button variant="ghost" onClick={() => state.open('project')}>
              <Plus size={16} />
              {t('新建项目')}
            </Button>
          </>
        )}
        {state.error && <p role="alert">{state.error}</p>}
      </main>
      <AppDialogs />
    </div>
  )
}

function ProjectUnavailable() {
  const { t } = useTranslation()
  const state = useApp()
  const current = state.snapshot?.workspaces.find((workspace) => workspace.id === state.workspaceId)
  const project = state.snapshot?.projects?.find((project) => project.id === state.workspaceId)
  return (
    <div className="project-start">
      <Logo />
      <h1>{current?.name ?? t('打开研究项目')}</h1>
      {project && (
        <>
          <p>{t('项目文件夹不可用')}</p>
          <code>{project.directory}</code>
        </>
      )}
      <div className="project-start-actions">
        <Button onClick={() => void openProjectFolder()} disabled={state.busy}>
          <FolderOpen size={16} />
          {t('打开项目文件夹')}
        </Button>
        <Button variant="ghost" onClick={() => state.open('workspace')}>
          <Plus size={16} />
          {t('新建研究空间')}
        </Button>
      </div>
      <nav>
        {state.snapshot?.workspaces
          .filter((workspace) => workspace.id !== state.workspaceId)
          .map((workspace) => (
            <Button
              variant="ghost"
              key={workspace.id}
              onClick={() => void state.workspace(workspace.id)}
            >
              {workspace.name}
            </Button>
          ))}
      </nav>
      {state.error && <p role="alert">{state.error}</p>}
      <AppDialogs />
    </div>
  )
}
