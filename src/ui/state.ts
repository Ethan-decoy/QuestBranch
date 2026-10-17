import { create } from 'zustand'
import type { AppCommand, Snapshot, ViewState } from '../research/types'
import { client } from './client'
import { ancestorPath } from '../research/context'

type Dialog = 'workspace' | 'node' | 'edit' | 'settings' | 'search' | 'compare' | null
type State = {
  snapshot: Snapshot | null
  workspaceId: string
  view: ViewState | null
  dialog: Dialog
  error: string
  busy: boolean
  panelWidth: number
  refresh: () => Promise<void>
  command: (command: AppCommand) => Promise<{ id?: string }>
  select: (id: string) => void
  workspace: (id: string) => void
  setView: (patch: Partial<ViewState>) => void
  open: (dialog: Dialog) => void
  setError: (error: string) => void
  setWidth: (width: number) => void
}
let timer: ReturnType<typeof setTimeout> | undefined
const retained = import.meta.hot?.data.state as
  Pick<State, 'snapshot' | 'workspaceId' | 'view'> | undefined
export const useApp = create<State>((set, get) => ({
  snapshot: retained?.snapshot ?? null,
  workspaceId: retained?.workspaceId ?? localStorage.getItem('questbranch-workspace') ?? '',
  view: retained?.view ?? null,
  dialog: null,
  error: '',
  busy: false,
  panelWidth: Number(localStorage.getItem('questbranch-panel-width')) || 420,
  async refresh() {
    try {
      const snapshot = await client.snapshot(),
        old = get()
      if (old.snapshot && snapshot.version <= old.snapshot.version) return
      for (const [id, local] of Object.entries(old.snapshot?.views ?? {}))
        if ((local.revision ?? 0) > (snapshot.views[id]?.revision ?? 0)) snapshot.views[id] = local
      const workspaceId = snapshot.workspaces.some((w) => w.id === old.workspaceId)
        ? old.workspaceId
        : (snapshot.workspaces[0]?.id ?? '')
      const view =
        old.view && old.workspaceId === workspaceId
          ? old.view
          : (snapshot.views[workspaceId] ?? {
              selectedId: snapshot.workspaces.find((w) => w.id === workspaceId)?.rootId ?? '',
              collapsed: [],
              drafts: {},
            })
      set({ snapshot, workspaceId, view })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '无法连接本地研究服务' })
    }
  },
  async command(command) {
    try {
      set({ busy: true })
      const result = await client.command(command)
      await get().refresh()
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作未完成'
      set({ error: message })
      throw error
    } finally {
      set({ busy: false })
    }
  },
  select(id) {
    const { snapshot, view } = get()
    if (!snapshot || !view) return
    const ancestors = ancestorPath(snapshot.nodes, id)
      .slice(0, -1)
      .map((n) => n.id)
    get().setView({
      selectedId: id,
      collapsed: view.collapsed.filter((id) => !ancestors.includes(id)),
    })
  },
  workspace(id) {
    const { snapshot } = get()
    if (!snapshot) return
    clearTimeout(timer)
    const previous = get()
    if (previous.view)
      void client
        .command({ type: 'save-view', workspaceId: previous.workspaceId, view: previous.view })
        .catch(() => {})
    localStorage.setItem('questbranch-workspace', id)
    set({
      workspaceId: id,
      view: snapshot.views[id] ?? {
        selectedId: snapshot.workspaces.find((w) => w.id === id)!.rootId,
        collapsed: [],
        drafts: {},
      },
    })
  },
  setView(patch) {
    const current = get()
    if (!current.view) return
    const view = {
      ...current.view,
      ...patch,
      revision: Math.max(Date.now(), (current.view.revision ?? 0) + 1),
    }
    set({
      view,
      snapshot: current.snapshot
        ? { ...current.snapshot, views: { ...current.snapshot.views, [current.workspaceId]: view } }
        : null,
    })
    clearTimeout(timer)
    timer = setTimeout(() => {
      void client
        .command({ type: 'save-view', workspaceId: current.workspaceId, view })
        .catch((error) => set({ error: String(error.message) }))
    }, 280)
  },
  open: (dialog) => set({ dialog }),
  setError: (error) => set({ error }),
  setWidth: (width) => {
    const panelWidth = Math.max(340, Math.min(680, width))
    localStorage.setItem('questbranch-panel-width', String(panelWidth))
    set({ panelWidth })
  },
}))
if (import.meta.hot)
  import.meta.hot.dispose((data) => {
    const { snapshot, workspaceId, view } = useApp.getState()
    data.state = { snapshot, workspaceId, view }
  })
export function flushView() {
  const state = useApp.getState()
  if (state.view) {
    clearTimeout(timer)
    const command: AppCommand = {
      type: 'save-view',
      workspaceId: state.workspaceId,
      view: state.view,
    }
    if (!window.questbranch && navigator.sendBeacon)
      navigator.sendBeacon(
        '/api/command',
        new Blob([JSON.stringify(command)], { type: 'application/json' }),
      )
    else void client.command(command).catch(() => {})
  }
}
export async function flushViewNow() {
  clearTimeout(timer)
  const { view, workspaceId } = useApp.getState()
  if (view) await client.command({ type: 'save-view', workspaceId, view })
}
export function download(data: unknown, name: string) {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    ),
    a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
