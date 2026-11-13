export type ResearchProject = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  lastWorkspaceId?: string
}
export type ResearchNavigation = { pinned?: boolean; order?: number; archivedAt?: string }
export type ProjectSummary = ResearchProject & {
  directory: string
  available: boolean
  legacy?: boolean
  pinned?: boolean
  order?: number
  error?: string
  nodeCount: number
}
export type ProjectNavigation = {
  collapsed: string[]
  recent: string[]
}
export type ProjectCommand =
  | { type: 'create-project'; name: string; requestId: string; directoryToken?: string }
  | {
      type: 'create-research'
      projectId: string
      question: string
      name?: string
      constraints?: string
      requestId: string
    }
  | { type: 'select-project'; projectId: string }
  | { type: 'select-research'; workspaceId: string }
  | { type: 'rename-project'; projectId: string; name: string }
  | { type: 'rename-research'; workspaceId: string; name: string }
  | { type: 'pin-project'; projectId: string; pinned: boolean }
  | { type: 'pin-research'; workspaceId: string; pinned: boolean }
  | {
      type: 'reorder-project'
      projectId: string
      targetProjectId: string
      placement: 'before' | 'after'
    }
  | {
      type: 'reorder-research'
      workspaceId: string
      targetWorkspaceId: string
      placement: 'before' | 'after'
    }
  | { type: 'archive-research'; workspaceId: string; archived: boolean }
  | { type: 'close-project'; projectId: string }
  | { type: 'move-research'; workspaceId: string; projectId: string; requestId: string }
  | { type: 'import-research'; projectId: string; data: unknown }
  | { type: 'save-navigation'; navigation: ProjectNavigation }

export type ProjectResult = { projectId?: string; workspaceId?: string }
