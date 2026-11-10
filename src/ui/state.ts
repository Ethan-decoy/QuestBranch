import { create } from 'zustand'
import type { AppCommand, Snapshot, ViewState, ReaderState } from '../research/types'
import { client } from './client'
import { graphPresentation, transitionView, type ViewAction } from './research-view'
import type { ResearchSearchHit } from './research-search'
import { branchReport } from '../research/branching'
import {
  defaultWorkbenchWidths,
  readWorkbenchWidths,
  saveWorkbenchWidths,
  type WorkbenchWidths,
} from './workbench-layout'
import i18next from '../i18n'
type NavigationTarget = Pick<
  ResearchSearchHit,
  'kind' | 'nodeId' | 'reportId' | 'sourceId' | 'query'
>

type Dialog =
  'workspace' | 'node' | 'sibling' | 'edit' | 'settings' | 'models' | 'search' | 'compare' | null
export type SettingsSection = 'general' | 'appearance' | 'shortcuts' | 'storage' | 'updates'
type State = {
  snapshot: Snapshot | null
  workspaceId: string
  view: ViewState | null
  dialog: Dialog
  settingsSection: SettingsSection
  setSettingsSection: (section: SettingsSection) => void
  error: string
  busy: boolean
  layoutWidths: WorkbenchWidths
  readingMode: boolean
  compactPane: 'map' | 'detail'
  dialogReturnToGraph: boolean
  navigationTarget: (NavigationTarget & { serial: number; viewport?: ViewState['viewport'] }) | null
  setReadingMode: (enabled: boolean) => void
  showPane: (pane: 'map' | 'detail') => void
  rememberReader: (nodeId: string, patch: Partial<ReaderState>) => void
  refresh: () => Promise<void>
  command: (command: AppCommand) => Promise<{ id?: string }>
  select: (id: string, options?: { showDetails?: boolean }) => void
  locate: (hit: NavigationTarget) => void
  jumpToRelated: (id: string) => void
  navigateGraph: (action: ViewAction) => void
  workspace: (id: string) => void
  setView: (patch: Partial<ViewState>) => void
  open: (
    dialog: Dialog,
    options?: { returnToGraph?: boolean; settingsSection?: SettingsSection },
  ) => void
  setError: (error: string) => void
  setLayoutWidths: (widths: WorkbenchWidths) => boolean
  resetLayout: () => boolean
}
let timer: ReturnType<typeof setTimeout> | undefined
const retained = import.meta.hot?.data.state as
  Pick<State, 'snapshot' | 'workspaceId' | 'view'> | undefined
export const useApp = create<State>((set, get) => ({
  snapshot: retained?.snapshot ?? null,
  workspaceId: retained?.workspaceId ?? localStorage.getItem('questbranch-workspace') ?? '',
  view: retained?.view ?? null,
  dialog: null,
  settingsSection: 'general',
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  error: '',
  busy: false,
  layoutWidths: readWorkbenchWidths(localStorage),
  readingMode: false,
  compactPane: 'detail',
  dialogReturnToGraph: false,
  navigationTarget: null,
  setReadingMode: (readingMode) => set({ readingMode, compactPane: 'detail' }),
  showPane: (compactPane) => set({ compactPane, readingMode: false }),
  rememberReader(nodeId, patch) {
    const view = get().view
    if (!view) return
    get().setView({
      readers: { ...view.readers, [nodeId]: { tab: 'chat', ...view.readers?.[nodeId], ...patch } },
    })
  },
  async refresh() {
    try {
      const previous = get().snapshot
      const snapshot = previous ? await client.snapshot(previous.version) : await client.snapshot()
      if (!snapshot) return
      const old = get()
      if (old.snapshot && snapshot.version <= old.snapshot.version) return
      for (const [id, local] of Object.entries(old.snapshot?.views ?? {}))
        if ((local.revision ?? 0) > (snapshot.views[id]?.revision ?? 0)) snapshot.views[id] = local
      const workspaceId = snapshot.workspaces.some((w) => w.id === old.workspaceId)
        ? old.workspaceId
        : (snapshot.workspaces[0]?.id ?? '')
      let view =
        old.view && old.workspaceId === workspaceId
          ? old.view
          : (snapshot.views[workspaceId] ?? {
              selectedId: snapshot.workspaces.find((w) => w.id === workspaceId)?.rootId ?? '',
              collapsed: [],
              drafts: {},
            })
      if (snapshot.nodes.find((node) => node.id === view.selectedId)?.removedAt) {
        const removed = snapshot.nodes.find((node) => node.id === view.selectedId)
        let parent = snapshot.nodes.find((node) => node.id === removed?.parentId)
        while (parent?.removedAt)
          parent = snapshot.nodes.find((node) => node.id === parent?.parentId)
        view = {
          ...view,
          selectedId:
            parent?.id ??
            snapshot.workspaces.find((workspace) => workspace.id === workspaceId)!.rootId,
        }
      }
      if (view.graph) {
        const available = new Set(
          snapshot.nodes
            .filter((node) => node.workspaceId === workspaceId && !node.removedAt)
            .map((node) => node.id),
        )
        const focusRemoved = view.graph.focusId && !available.has(view.graph.focusId)
        const history = view.graph.history?.filter(
          (frame) =>
            available.has(frame.selectedId) && (!frame.focusId || available.has(frame.focusId)),
        )
        if (focusRemoved || history?.length !== view.graph.history?.length)
          view = {
            ...view,
            graph: { ...view.graph, ...(focusRemoved ? { focusId: undefined } : {}), history },
          }
      }
      set({ snapshot, workspaceId, view })
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : i18next.t('无法连接本地研究服务'),
      })
    }
  },
  async command(command) {
    try {
      if (command.type === 'send-message' || command.type === 'start-research') {
        const { snapshot, view } = get()
        // Capture the reader selection in the request, independent of debounced
        // view persistence and subsequent navigation while the run starts.
        if (snapshot)
          command = {
            ...command,
            selectedReportId: branchReport(snapshot, command.nodeId, view)?.id,
          }
      }
      set({ busy: true })
      const result = await client.command(command)
      await get().refresh()
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : i18next.t('操作未完成')
      set({ error: message })
      throw error
    } finally {
      set({ busy: false })
    }
  },
  select(id, { showDetails = true } = {}) {
    const { snapshot, view } = get()
    if (!snapshot || !view) return
    const focusDetails =
      document.activeElement?.closest('.details-panel') ||
      (matchMedia('(max-width: 1100px)').matches && document.activeElement?.closest('.graph-slot'))
    get().setView(
      transitionView(
        snapshot.nodes.filter((node) => node.workspaceId === get().workspaceId && !node.removedAt),
        view,
        { type: 'select', nodeId: id },
      ),
    )
    set({ navigationTarget: null, ...(showDetails ? { compactPane: 'detail' } : {}) })
    if (focusDetails && showDetails)
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>('.details-panel [role="tab"][aria-selected="true"]')
          ?.focus(),
      )
  },
  locate(hit) {
    const { snapshot, view, workspaceId } = get()
    if (!snapshot || !view) return
    const nodes = snapshot.nodes.filter(
      (node) => node.workspaceId === workspaceId && !node.removedAt,
    )
    if (!nodes.some((node) => node.id === hit.nodeId)) return
    get().setView({
      ...transitionView(nodes, view, { type: 'select', nodeId: hit.nodeId }),
      ...(hit.kind !== 'node'
        ? {
            readers: {
              ...view.readers,
              [hit.nodeId]: {
                ...view.readers?.[hit.nodeId],
                tab: hit.kind === 'source' ? 'sources' : 'report',
                reportId: hit.reportId,
              },
            },
          }
        : {}),
    })
    set({
      navigationTarget: {
        ...hit,
        serial: Math.max(Date.now(), (get().navigationTarget?.serial ?? 0) + 1),
      },
      compactPane: 'detail',
    })
  },
  jumpToRelated(id) {
    const { snapshot, view, workspaceId } = get()
    if (!snapshot || !view || id === view.selectedId) return
    const patch = transitionView(
      snapshot.nodes.filter((node) => node.workspaceId === workspaceId && !node.removedAt),
      view,
      { type: 'related', nodeId: id },
    )
    if (!patch.selectedId) return
    get().setView(patch)
    set({
      navigationTarget: {
        kind: 'node',
        query: '',
        nodeId: id,
        serial: Math.max(Date.now(), (get().navigationTarget?.serial ?? 0) + 1),
      },
      compactPane: 'map',
      readingMode: false,
    })
  },
  navigateGraph(action) {
    const { snapshot, view, workspaceId } = get()
    if (snapshot && view)
      get().setView(
        transitionView(
          snapshot.nodes.filter((node) => node.workspaceId === workspaceId && !node.removedAt),
          view,
          action,
        ),
      )
    if ((action.type === 'back' || action.type === 'global') && get().view) {
      const restored = get().view!
      set({
        navigationTarget: {
          kind: 'node',
          query: '',
          nodeId: restored.selectedId,
          serial: Math.max(Date.now(), (get().navigationTarget?.serial ?? 0) + 1),
          viewport: graphPresentation(restored).scene.viewport,
        },
      })
    }
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
      navigationTarget: null,
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
  open: (dialog, options) => {
    if (dialog === 'node' || dialog === 'sibling') {
      const { snapshot, view } = get()
      const node = snapshot?.nodes.find((node) => node.id === view?.selectedId)
      if (!snapshot || !branchReport(snapshot, dialog === 'node' ? node?.id : node?.parentId, view))
        return
    }
    set({
      dialog,
      dialogReturnToGraph: options?.returnToGraph ?? false,
      ...(dialog === 'settings' ? { settingsSection: options?.settingsSection ?? 'general' } : {}),
    })
  },
  setError: (error) => set({ error }),
  setLayoutWidths: (layoutWidths) => {
    const saved = saveWorkbenchWidths(localStorage, layoutWidths)
    set({
      layoutWidths,
      ...(!saved ? { error: i18next.t('布局已调整，但无法保存本机布局偏好') } : {}),
    })
    return saved
  },
  resetLayout: () => get().setLayoutWidths({ ...defaultWorkbenchWidths }),
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
