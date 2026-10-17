import { z } from 'zod'

export const SourceSchema = z.object({
  id: z.string().max(200),
  title: z.string().max(1000),
  url: z
    .url()
    .max(4000)
    .refine((url) => /^https?:\/\//i.test(url), '资料链接应使用 HTTP 或 HTTPS'),
  excerpt: z.string().max(20000).default(''),
})
export type Source = z.infer<typeof SourceSchema>
export type Workspace = {
  id: string
  name: string
  question: string
  objective: string
  constraints: string
  rootId: string
  createdAt: string
  updatedAt: string
}
export type ResearchNode = {
  id: string
  workspaceId: string
  parentId: string | null
  title: string
  question: string
  summary: string
  openQuestions: string[]
  color: string
  relatedIds: string[]
  createdAt: string
  updatedAt: string
  originReportId?: string
}
export type Report = {
  id: string
  workspaceId: string
  nodeId: string
  title: string
  markdown: string
  summary: string
  findings: string[]
  openQuestions: string[]
  sources: Source[]
  createdAt: string
  origin: 'ai' | 'import'
  model: string
  runId?: string
}
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export type ContextItem = {
  reportId: string
  nodeId: string
  title: string
  reason: string
  included: boolean
  excerpted: boolean
}
export type ContextPack = {
  policy: 'branch-v1'
  createdAt: string
  workspaceId: string
  nodeId: string
  path: string[]
  items: ContextItem[]
  sources: Source[]
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  conversation?: { includedMessageIds: string[]; omittedMessageIds: string[] }
  estimatedTokens: number
  budget: number
  limitations: string[]
}
export type ResearchRun = {
  id: string
  workspaceId: string
  nodeId: string
  instruction: string
  status: RunStatus
  phase: string
  output: string
  error: string
  model: string
  context: ContextPack
  createdAt: string
  finishedAt?: string
  reportId?: string
  mode?: 'chat'
  provider?: Settings['provider']
  codex?: { threadId: string; turnId?: string }
}
export type ConversationMessage = {
  id: string
  workspaceId: string
  nodeId: string
  runId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}
export type ViewState = {
  revision?: number
  selectedId: string
  collapsed: string[]
  drafts: Record<string, string>
  chatDrafts?: Record<string, string>
  viewport?: { x: number; y: number; zoom: number }
  positions?: Record<string, { x: number; y: number }>
}
export type Settings = {
  provider: 'compatible' | 'ollama' | 'codex'
  baseUrl: string
  model: string
  jsonMode: boolean
  contextBudget: number
  hasApiKey: boolean
  hasSearchKey: boolean
  codexPath?: string
}
export type ConnectionResult = {
  models: string[]
  account?: { type: 'chatgpt'; plan: string; email: string | null }
  usage?: { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null }[]
}
export type SettingsInput = Omit<Settings, 'hasApiKey' | 'hasSearchKey'> & {
  apiKey?: string
  searchKey?: string
  clearApiKey?: boolean
  clearSearchKey?: boolean
}
export type Snapshot = {
  version: number
  workspaces: Workspace[]
  nodes: ResearchNode[]
  reports: Report[]
  runs: ResearchRun[]
  messages: ConversationMessage[]
  views: Record<string, ViewState>
  settings: Settings
  storage?: {
    directory: string
    database: string
    source?: 'default' | 'preference' | 'environment'
  }
}
export const ResearchOutputSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(1500),
  findings: z.array(z.string()).max(20),
  openQuestions: z.array(z.string()).max(20),
  report: z.string().min(20).max(100000),
  followups: z
    .array(z.object({ title: z.string().min(1).max(100), question: z.string().min(1).max(3000) }))
    .max(8),
})
export type ResearchOutput = z.infer<typeof ResearchOutputSchema>
export type AppCommand =
  | { type: 'create-workspace'; question: string; name?: string; constraints?: string }
  | { type: 'create-node'; parentId: string; question: string; relatedIds?: string[] }
  | { type: 'edit-node'; nodeId: string; question: string }
  | { type: 'save-view'; workspaceId: string; view: ViewState }
  | { type: 'save-settings'; settings: SettingsInput }
  | { type: 'start-research'; nodeId: string; instruction: string; reportIds?: string[] }
  | { type: 'send-message'; nodeId: string; message: string }
  | { type: 'cancel-research'; runId: string }
  | { type: 'import-workspace'; data: unknown }
export interface ResearchClient {
  snapshot(): Promise<Snapshot>
  command(command: AppCommand): Promise<{ id?: string }>
  testConnection(): Promise<ConnectionResult>
  exportWorkspace(workspaceId: string): Promise<unknown>
  storage?: {
    chooseDirectory(): Promise<{ directory: string; token: string } | null>
    relocate(token: string): Promise<void>
  }
}
export const defaultSettings: Settings = {
  provider: 'compatible',
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  jsonMode: false,
  contextBudget: 16000,
  hasApiKey: false,
  hasSearchKey: false,
}
export const palette = ['#4e806d', '#7186aa', '#b38a5b', '#a88092', '#7d8d61']
