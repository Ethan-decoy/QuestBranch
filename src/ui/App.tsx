import { useEffect, useRef, useState } from 'react'
import { version } from '../../package.json'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  Check,
  ChevronRight,
  Columns2,
  FolderOpen,
  GitBranch,
  HelpCircle,
  Layers3,
  LoaderCircle,
  Plus,
  Search,
  Settings2,
  X,
} from 'lucide-react'
import { useApp, download, flushView } from './state'
import { client } from './client'
import { Button, Logo } from './components'
import { ResearchGraph } from './graph'
import { ResearchDetails } from './details'
import { AppDialogs } from './dialogs'

export function App() {
  const snapshot = useApp((s) => s.snapshot),
    workspaceId = useApp((s) => s.workspaceId),
    view = useApp((s) => s.view),
    open = useApp((s) => s.open),
    select = useApp((s) => s.select),
    changeWorkspace = useApp((s) => s.workspace),
    error = useApp((s) => s.error),
    width = useApp((s) => s.panelWidth),
    setWidth = useApp((s) => s.setWidth),
    fileInput = useRef<HTMLInputElement>(null),
    [exporting, setExporting] = useState(false)
  useEffect(() => {
    void useApp.getState().refresh()
    const interval = setInterval(() => {
      if (!document.hidden) void useApp.getState().refresh()
    }, 1100)
    const keys = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        open('search')
      }
    }
    window.addEventListener('keydown', keys)
    window.addEventListener('beforeunload', flushView)
    return () => {
      clearInterval(interval)
      window.removeEventListener('keydown', keys)
      window.removeEventListener('beforeunload', flushView)
    }
  }, [])
  if (!snapshot || !view)
    return (
      <div className="loading-screen">
        <Logo />
        <LoaderCircle size={22} className="spin" />
        <p>{error || '正在打开你的研究空间…'}</p>
      </div>
    )
  const workspace = snapshot.workspaces.find((w) => w.id === workspaceId)!,
    nodes = snapshot.nodes.filter((n) => n.workspaceId === workspaceId),
    root = nodes.find((n) => n.id === workspace.rootId)!,
    branches = nodes.filter((n) => n.parentId === root.id),
    reports = snapshot.reports.filter((r) => r.workspaceId === workspaceId),
    pending = nodes.filter((n) => !reports.some((r) => r.nodeId === n.id)).length
  async function exportData() {
    setExporting(true)
    try {
      download(
        await client.exportWorkspace(workspaceId),
        `${workspace.name.replace(/[<>:"/\\|?*]/g, '-')}.questbranch.json`,
      )
    } catch (error) {
      useApp.getState().setError(error instanceof Error ? error.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }
  async function importData(file: File) {
    try {
      if (file.size > 64 * 1024 * 1024)
        throw new Error('导入文件超过 64 MB，请拆分研究空间或保留原数据库作为备份。')
      const data = JSON.parse(await file.text()),
        result = await useApp.getState().command({ type: 'import-workspace', data })
      changeWorkspace(result.id!)
    } catch (error) {
      useApp
        .getState()
        .setError(error instanceof Error ? error.message : '导入失败，请检查文件格式')
    }
  }
  return (
    <div className="app-shell" style={{ '--panel-width': `${width}px` } as React.CSSProperties}>
      <aside className="sidebar">
        <Logo />
        <Button className="new-workspace" onClick={() => open('workspace')}>
          <Plus size={15} />
          新建研究空间
        </Button>
        <div className="sidebar-section">
          <div className="sidebar-label">
            研究空间<span>{snapshot.workspaces.length}</span>
          </div>
          <nav aria-label="研究空间">
            {snapshot.workspaces.map((w) => (
              <button
                className={`workspace-item ${w.id === workspaceId ? 'active' : ''}`}
                key={w.id}
                onClick={() => changeWorkspace(w.id)}
              >
                <span className="workspace-icon">
                  <GitBranch size={16} />
                </span>
                <div>
                  <strong>{w.name}</strong>
                  <small>
                    {snapshot.nodes.filter((n) => n.workspaceId === w.id).length} 个研究节点
                  </small>
                </div>
              </button>
            ))}
          </nav>
        </div>
        <div className="sidebar-section directions">
          <div className="sidebar-label">
            当前研究脉络
            <button
              className="icon-button"
              title="回到根问题"
              aria-label="回到根问题"
              onClick={() => select(root.id)}
            >
              <Layers3 size={13} />
            </button>
          </div>
          <button
            className={`root-link ${view.selectedId === root.id ? 'selected' : ''}`}
            onClick={() => select(root.id)}
          >
            <span className="tree-root-dot" />
            <span>{workspace.question}</span>
          </button>
          <nav className="branch-nav" aria-label="研究分支">
            {branches.map((branch) => (
              <button
                key={branch.id}
                className={view.selectedId === branch.id ? 'selected' : ''}
                onClick={() => select(branch.id)}
              >
                <span className="branch-line" />
                <i style={{ background: branch.color }} />
                <span>{branch.title}</span>
                <ChevronRight size={11} />
              </button>
            ))}
          </nav>
        </div>
        <div className="sidebar-spacer" />
        <div className="thought-card">
          <div>
            <BookOpen size={15} />
            <span>让研究有方向，也有来处</span>
          </div>
          <p>从一个问题出发，把每一步认识连成自己的思考地图。</p>
          <span className="thought-line" />
        </div>
        <div className="sidebar-bottom">
          <button onClick={() => open('settings')}>
            <Settings2 size={16} />
            <span>模型与设置</span>
            <span className={`connection-dot ${snapshot.settings.model ? 'connected' : ''}`} />
          </button>
          <button onClick={() => fileInput.current?.click()}>
            <ArrowUpFromLine size={15} />
            <span>导入研究资料</span>
          </button>
          <div className="local-label">
            <span className="save-dot" />
            本地工作空间<span>v{version}</span>
          </div>
        </div>
      </aside>
      <main className="workspace-main">
        <header className="topbar">
          <div className="workspace-breadcrumb">
            <FolderOpen size={15} />
            <span>研究空间</span>
            <ChevronRight size={12} />
            <strong>{workspace.name}</strong>
          </div>
          <div className="topbar-actions">
            <button className="search-button" onClick={() => open('search')} aria-label="搜索研究">
              <Search size={15} />
              <span>搜索</span>
              <kbd>Ctrl K</kbd>
            </button>
            <button
              className="icon-button"
              title="导出当前研究空间"
              aria-label="导出研究空间"
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
        <div className="workspace-toolbar">
          <div className="view-tabs">
            <button className="active">
              <GitBranch size={15} />
              研究图谱
            </button>
            <span className="workspace-count">
              {nodes.length} 个节点 <span>·</span> {pending} 个待研究
            </span>
          </div>
          <div className="toolbar-actions">
            <Button variant="ghost" onClick={() => open('compare')}>
              <Columns2 size={14} />
              分支比较
            </Button>
            <Button onClick={() => open('node')}>
              <Plus size={14} />
              新方向
            </Button>
          </div>
        </div>
        <div className="workspace-content">
          <ResearchGraph />
          <div
            className="panel-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整报告区域宽度"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') setWidth(width + 24)
              if (event.key === 'ArrowRight') setWidth(width - 24)
            }}
            onPointerDown={(event) => {
              event.preventDefault()
              const start = event.clientX,
                initial = width
              event.currentTarget.setPointerCapture(event.pointerId)
              const move = (move: PointerEvent) => setWidth(initial + start - move.clientX),
                up = () => {
                  document.removeEventListener('pointermove', move)
                  document.removeEventListener('pointerup', up)
                  document.body.style.cursor = ''
                }
              document.body.style.cursor = 'col-resize'
              document.addEventListener('pointermove', move)
              document.addEventListener('pointerup', up)
            }}
          />
          <ResearchDetails />
        </div>
      </main>
      <AppDialogs />
      <input
        type="file"
        ref={fileInput}
        accept=".json,application/json"
        hidden
        aria-label="导入研究文件"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importData(file)
          event.target.value = ''
        }}
      />
      {error && (
        <div className="error-toast" role="alert">
          <div>
            <HelpCircle size={17} />
            <span>{error}</span>
          </div>
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => useApp.getState().setError('')}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
