import { afterEach, describe, expect, it, vi } from 'vitest'
import { starterResearch } from '../src/research/seed'
import { defaultSettings, type Snapshot, type AppCommand } from '../src/research/types'

function fixture(): Snapshot {
  const seed = starterResearch()
  return {
    version: 0,
    workspaces: [seed.workspace],
    nodes: seed.nodes,
    reports: seed.reports,
    runs: [],
    messages: [],
    views: {
      [seed.workspace.id]: { selectedId: seed.workspace.rootId, collapsed: [], drafts: {} },
    },
    settings: defaultSettings,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('跨承载的条件快照', () => {
  it('快速切换项目时，较早请求的迟到响应不会把界面切回旧项目', async () => {
    const state = fixture()
    const first = state.workspaces[0]
    const second = { ...first, id: 'second-project', rootId: 'second-root', name: '项目二' }
    state.workspaces.push(second)
    state.nodes.push({ ...state.nodes[0], id: second.rootId, workspaceId: second.id })
    state.activeWorkspaceId = first.id
    let finish = () => {}
    const delayed = new Promise<void>((resolve) => {
      finish = resolve
    })
    const activate = vi.fn(async ({ workspaceId: id }: { workspaceId: string }) => {
      state.activeWorkspaceId = id
      state.version++
      if (id === second.id) await delayed
    })
    vi.stubGlobal('window', {
      questbranch: {
        snapshot: async (version?: number) =>
          version === state.version ? null : structuredClone(state),
        command: async () => ({}),
        projects: { command: activate },
      },
    })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
    const { useApp } = await import('../src/ui/state')
    await useApp.getState().refresh()
    const older = useApp.getState().workspace(second.id)
    await vi.waitFor(() =>
      expect(activate).toHaveBeenCalledWith({ type: 'select-research', workspaceId: second.id }),
    )
    await useApp.getState().workspace(first.id)
    finish()
    await older
    expect(useApp.getState().workspaceId).toBe(first.id)
    expect(useApp.getState().snapshot?.activeWorkspaceId).toBe(first.id)
  })
  it('用户正在查看的子树被移除时回到活动祖先，清除失效聚焦与返回历史并保留布局偏好', async () => {
    let state = fixture()
    const root = state.workspaces[0].rootId
    state.views[state.workspaces[0].id] = {
      selectedId: 'layout',
      collapsed: [],
      drafts: {},
      graph: {
        mode: 'mindmap',
        detail: 'compact',
        focusId: 'visual',
        history: [
          { selectedId: root, mode: 'horizontal', detail: 'summary' },
          { selectedId: 'layout', focusId: 'visual', mode: 'mindmap', detail: 'compact' },
        ],
      },
    }
    vi.stubGlobal('window', { questbranch: { snapshot: async () => state } })
    vi.stubGlobal('localStorage', { getItem: () => null })
    const { useApp } = await import('../src/ui/state')
    await useApp.getState().refresh()
    state = {
      ...state,
      version: 1,
      nodes: state.nodes.map((node) =>
        ['visual', 'layout', 'progress'].includes(node.id)
          ? { ...node, removedAt: new Date().toISOString(), removalId: 'remove-visual' }
          : node,
      ),
    }
    await useApp.getState().refresh()
    const view = useApp.getState().view!
    expect(view.selectedId).toBe(root)
    expect(view.graph?.focusId).toBeUndefined()
    expect(view.graph?.mode).toBe('mindmap')
    expect(view.graph?.detail).toBe('compact')
    expect(view.graph?.history).toHaveLength(1)
    expect(view.graph?.history?.[0].selectedId).toBe(root)
  })
  it('刚切历史版本即发送时固定内存中的版本，不等待视图防抖；后续切换不改写本轮', async () => {
    const state = fixture(),
      workspace = state.workspaces[0],
      root = workspace.rootId
    const r1 = state.reports.find((report) => report.nodeId === root)!
    const r2 = { ...r1, id: 'root-new-version' }
    state.reports.push(r2)
    state.views[workspace.id].readers = { [root]: { tab: 'report', reportId: r2.id } }
    const command = vi.fn(async (_input: AppCommand) => ({ id: 'fixture-run' }))
    vi.stubGlobal('window', {
      questbranch: {
        snapshot: async (version?: number) => (version === undefined ? state : null),
        command,
      },
    })
    vi.stubGlobal('localStorage', { getItem: () => null })
    const { useApp } = await import('../src/ui/state')
    await useApp.getState().refresh()
    vi.useFakeTimers()
    try {
      useApp.getState().rememberReader(root, { reportId: r1.id })
      expect(command).not.toHaveBeenCalled()
      const sending = useApp
        .getState()
        .command({ type: 'send-message', nodeId: root, message: '基于这份报告创建分支' })
      useApp.getState().rememberReader(root, { reportId: r2.id })
      await sending
      expect(command.mock.calls[0][0]).toMatchObject({
        type: 'send-message',
        nodeId: root,
        selectedReportId: r1.id,
      })
      await vi.advanceTimersByTimeAsync(280)
      expect(command.mock.calls[1][0]).toMatchObject({
        type: 'save-view',
        view: { readers: { [root]: { reportId: r2.id } } },
      })
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })
  it('浏览器首读完整状态，版本零也发送条件，并原样接受未变化响应', async () => {
    vi.stubGlobal('window', {})
    const state = fixture()
    const fetch = vi.fn(
      async (url: string) =>
        new Response(JSON.stringify(url.includes('sinceVersion=') ? null : state)),
    )
    vi.stubGlobal('fetch', fetch)
    const { client } = await import('../src/ui/client')
    expect(await client.snapshot()).toEqual(state)
    expect(await client.snapshot(0)).toBeNull()
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/state',
      '/api/state?sinceVersion=0',
    ])
  })
  it('未变化时保留前端对象与研究视图，不发布新的状态更新', async () => {
    const state = fixture()
    const snapshot = vi.fn(async (version?: number) => (version === state.version ? null : state))
    vi.stubGlobal('window', { questbranch: { snapshot } })
    vi.stubGlobal('localStorage', { getItem: () => null })
    const { useApp } = await import('../src/ui/state')
    await useApp.getState().refresh()
    const before = useApp.getState()
    const listener = vi.fn()
    const unsubscribe = useApp.subscribe(listener)
    try {
      await useApp.getState().refresh()
      expect(snapshot.mock.calls).toEqual([[], [0]])
      expect(useApp.getState().snapshot).toBe(before.snapshot)
      expect(useApp.getState().view).toBe(before.view)
      expect(listener).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
    }
  })
  it('慢请求晚到时不会覆盖已经收到的较新研究状态', async () => {
    const state = fixture()
    const snapshot = vi.fn(async (_version?: number): Promise<Snapshot | null> => state)
    vi.stubGlobal('window', { questbranch: { snapshot } })
    vi.stubGlobal('localStorage', { getItem: () => null })
    const { useApp } = await import('../src/ui/state')
    await useApp.getState().refresh()
    let resolveOld!: (value: Snapshot) => void
    let resolveNew!: (value: Snapshot) => void
    snapshot
      .mockImplementationOnce(() => new Promise<Snapshot>((resolve) => (resolveOld = resolve)))
      .mockImplementationOnce(() => new Promise<Snapshot>((resolve) => (resolveNew = resolve)))
    const oldRequest = useApp.getState().refresh()
    const newRequest = useApp.getState().refresh()
    resolveNew({ ...state, version: 2 })
    await newRequest
    resolveOld({ ...state, version: 1 })
    await oldRequest
    expect(useApp.getState().snapshot?.version).toBe(2)
  })
})
